using System.Security.Claims;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Chime.Api.Contracts;
using Chime.Api.Data;

namespace Chime.Api.Endpoints;

public static class AccountEndpoints
{
    public static RouteGroupBuilder MapAccountEndpoints(this RouteGroupBuilder api)
    {
        api.MapGet("/me", async Task<Results<Ok<MeResponse>, UnauthorizedHttpResult>> (ClaimsPrincipal principal, AppDbContext db) =>
        {
            var user = await db.Users.FindAsync(principal.GetUserId());
            return user is null
                ? TypedResults.Unauthorized()
                : TypedResults.Ok(new MeResponse(user.Id, user.Email!, user.CreatedAt));
        });

        api.MapGet("/settings", async (ClaimsPrincipal principal, AppDbContext db) =>
            TypedResults.Ok(SettingsDto.From(await db.GetOrCreateSettingsAsync(principal.GetUserId()))));

        api.MapPut("/settings", async (SettingsDto dto, ClaimsPrincipal principal, AppDbContext db) =>
        {
            var settings = await db.GetOrCreateSettingsAsync(principal.GetUserId());
            settings.SyncEnabled = dto.SyncEnabled;
            settings.IncludeMessageBody = dto.IncludeMessageBody;
            settings.RetentionDays = dto.RetentionDays;
            settings.MutedApps = dto.MutedApps.Select(a => a.Trim()).Where(a => a.Length > 0).Distinct().ToList();
            settings.EnabledCategories = dto.EnabledCategories.Distinct().ToList();
            await db.SaveChangesAsync();
            return TypedResults.Ok(SettingsDto.From(settings));
        });

        // Permanently deletes the account and everything linked to it. Outstanding tokens stop working at once
        // (see ExistingUserFilter) and refresh tokens fail their security-stamp check, so every client signs out.
        api.MapDelete("/account", async Task<Results<NoContent, UnauthorizedHttpResult, ProblemHttpResult>> (
            ClaimsPrincipal principal, AppDbContext db, UserManager<AppUser> users, ILoggerFactory loggers) =>
        {
            var user = await users.FindByIdAsync(principal.GetUserId());
            if (user is null) return TypedResults.Unauthorized();

            await using var transaction = await db.Database.BeginTransactionAsync();
            // The schema cascades these, but delete them explicitly so nothing depends on SQLite's foreign_keys pragma.
            await db.Notifications.Where(n => n.UserId == user.Id).ExecuteDeleteAsync();
            await db.Devices.Where(d => d.UserId == user.Id).ExecuteDeleteAsync();
            await db.UserSettings.Where(s => s.UserId == user.Id).ExecuteDeleteAsync();
            await db.UserLogins.Where(l => l.UserId == user.Id).ExecuteDeleteAsync();
            await db.UserTokens.Where(t => t.UserId == user.Id).ExecuteDeleteAsync();
            await db.UserClaims.Where(c => c.UserId == user.Id).ExecuteDeleteAsync();
            await db.UserRoles.Where(r => r.UserId == user.Id).ExecuteDeleteAsync();

            var deleted = await users.DeleteAsync(user);
            if (!deleted.Succeeded)
            {
                return TypedResults.Problem(string.Join(" ", deleted.Errors.Select(e => e.Description)),
                    statusCode: StatusCodes.Status500InternalServerError);
            }
            await transaction.CommitAsync();

            loggers.CreateLogger("Chime.Api.Account").LogInformation("Deleted account {UserId}", user.Id);
            return TypedResults.NoContent();
        });

        return api;
    }

    public static string GetUserId(this ClaimsPrincipal principal) =>
        principal.FindFirstValue(ClaimTypes.NameIdentifier)
        ?? throw new InvalidOperationException("Authenticated principal has no user id.");

    public static async Task<UserSettings> GetOrCreateSettingsAsync(this AppDbContext db, string userId)
    {
        var settings = await db.UserSettings.SingleOrDefaultAsync(s => s.UserId == userId);
        if (settings is null)
        {
            settings = new UserSettings { UserId = userId };
            db.UserSettings.Add(settings);
            await db.SaveChangesAsync();
        }
        return settings;
    }
}
