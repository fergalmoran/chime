using System.Security.Claims;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Chime.Api.Contracts;
using Chime.Api.Data;
using Chime.Api.Hubs;
using Chime.Api.Services;

namespace Chime.Api.Endpoints;

public static class NotificationEndpoints
{
    private const int MaxPageSize = 200;

    public static RouteGroupBuilder MapNotificationEndpoints(this RouteGroupBuilder api)
    {
        var group = api.MapGroup("/notifications");

        group.MapGet("/", async (ClaimsPrincipal principal, AppDbContext db, DateTimeOffset? before, int? limit, bool? includeDismissed) =>
        {
            var userId = principal.GetUserId();
            var take = Math.Clamp(limit ?? 50, 1, MaxPageSize);

            var query = db.Notifications.AsNoTracking().Where(n => n.UserId == userId);
            if (includeDismissed != true) query = query.Where(n => n.DismissedAt == null);
            if (before is { } b) query = query.Where(n => n.ReceivedAt < b);

            var items = await query.OrderByDescending(n => n.ReceivedAt).Take(take + 1).ToListAsync();
            var hasMore = items.Count > take;
            var page = items.Take(take).Select(NotificationDto.From).ToList();
            return TypedResults.Ok(new NotificationPage(page, hasMore ? page[^1].ReceivedAt : null));
        });

        group.MapPost("/", CreateAsync);

        group.MapPost("/{id:guid}/dismiss", async Task<Results<NoContent, NotFound>> (
            Guid id, ClaimsPrincipal principal, AppDbContext db, IHubContext<NotificationsHub, INotificationsClient> hub,
            IBrowserPushQueue browserPush) =>
        {
            var userId = principal.GetUserId();
            var updated = await db.Notifications
                .Where(n => n.Id == id && n.UserId == userId && n.DismissedAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(n => n.DismissedAt, DateTimeOffset.UtcNow));
            if (updated == 0) return TypedResults.NotFound();

            await hub.Clients.User(userId).NotificationDismissed(id);
            browserPush.FeedChanged(userId);
            return TypedResults.NoContent();
        });

        group.MapDelete("/{id:guid}", async Task<Results<NoContent, NotFound>> (Guid id, ClaimsPrincipal principal, AppDbContext db) =>
        {
            var userId = principal.GetUserId();
            var deleted = await db.Notifications.Where(n => n.Id == id && n.UserId == userId).ExecuteDeleteAsync();
            return deleted == 0 ? TypedResults.NotFound() : TypedResults.NoContent();
        });

        return api;
    }

    /// <summary>
    /// Called by a source device (e.g. the Android app) when a notification arrives.
    /// Returns 201 when stored, 200 when it is a duplicate upload and 204 when filtered out by the user's settings.
    /// </summary>
    private static async Task<Results<Created<NotificationDto>, Ok<NotificationDto>, NoContent, ValidationProblem>> CreateAsync(
        CreateNotificationRequest request,
        ClaimsPrincipal principal,
        AppDbContext db,
        IHubContext<NotificationsHub, INotificationsClient> hub,
        IBrowserPushQueue browserPush,
        TimeProvider clock)
    {
        var userId = principal.GetUserId();
        var now = clock.GetUtcNow();

        Device? device = null;
        if (request.DeviceId is { } deviceId)
        {
            device = await db.Devices.SingleOrDefaultAsync(d => d.Id == deviceId && d.UserId == userId);
            if (device is null)
            {
                return TypedResults.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.DeviceId)] = ["Unknown device."],
                });
            }
            device.LastSeenAt = now;
        }

        if (request.ExternalKey is { } key)
        {
            var existing = await db.Notifications.AsNoTracking().SingleOrDefaultAsync(n => n.UserId == userId && n.ExternalKey == key);
            if (existing is not null)
            {
                await db.SaveChangesAsync();
                return TypedResults.Ok(NotificationDto.From(existing));
            }
        }

        var settings = await db.GetOrCreateSettingsAsync(userId);
        if (!settings.SyncEnabled
            || !settings.EnabledCategories.Contains(request.Category)
            || settings.MutedApps.Contains(request.AppId))
        {
            await db.SaveChangesAsync();
            return TypedResults.NoContent();
        }

        var notification = new Notification
        {
            UserId = userId,
            SourceDeviceId = device?.Id,
            AppId = request.AppId,
            AppName = request.AppName,
            Category = request.Category,
            Title = request.Title,
            Body = settings.IncludeMessageBody ? request.Body : null,
            ExternalKey = request.ExternalKey,
            PostedAt = request.PostedAt ?? now,
            ReceivedAt = now,
        };
        db.Notifications.Add(notification);
        await db.SaveChangesAsync();

        var dto = NotificationDto.From(notification);
        await hub.Clients.User(userId).NotificationReceived(dto);
        browserPush.FeedChanged(userId);
        return TypedResults.Created($"/api/notifications/{notification.Id}", dto);
    }
}
