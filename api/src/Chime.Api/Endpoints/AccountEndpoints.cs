using System.Security.Claims;
using Microsoft.AspNetCore.Http.HttpResults;
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
