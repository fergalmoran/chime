using System.Security.Claims;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Chime.Api.Contracts;
using Chime.Api.Data;
using Chime.Api.Services;

namespace Chime.Api.Endpoints;

/// <summary>Web Push registration for browser extensions; they fall back to polling when it is unavailable.</summary>
public static class WebPushEndpoints
{
    public static RouteGroupBuilder MapWebPushEndpoints(this RouteGroupBuilder api)
    {
        api.MapGet("/web-push/key", Results<Ok<WebPushKeyResponse>, NotFound> (IOptions<WebPushOptions> options) =>
            options.Value.IsConfigured
                ? TypedResults.Ok(new WebPushKeyResponse(options.Value.PublicKey!))
                : TypedResults.NotFound());

        var device = api.MapGroup("/devices/{id:guid}/web-push");

        device.MapPut("/", async Task<Results<NoContent, NotFound, ValidationProblem>> (
            Guid id, WebPushSubscriptionRequest request, ClaimsPrincipal principal, AppDbContext db) =>
        {
            if (!WebPushSender.IsAllowedEndpoint(request.Endpoint))
            {
                return TypedResults.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.Endpoint)] = ["Endpoint must be an HTTPS URL of a browser push service."],
                });
            }

            var target = await db.Devices.SingleOrDefaultAsync(d => d.Id == id && d.UserId == principal.GetUserId());
            if (target is null) return TypedResults.NotFound();
            if (target.Platform != DevicePlatform.Browser)
            {
                return TypedResults.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.Endpoint)] = ["Only browser extension devices can register for Web Push."],
                });
            }

            target.WebPushEndpoint = request.Endpoint;
            target.WebPushP256dh = request.P256dh;
            target.WebPushAuth = request.Auth;
            target.LastSeenAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
            return TypedResults.NoContent();
        });

        device.MapDelete("/", async Task<Results<NoContent, NotFound>> (Guid id, ClaimsPrincipal principal, AppDbContext db) =>
        {
            var updated = await db.Devices
                .Where(d => d.Id == id && d.UserId == principal.GetUserId())
                .ExecuteUpdateAsync(s => s
                    .SetProperty(d => d.WebPushEndpoint, (string?)null)
                    .SetProperty(d => d.WebPushP256dh, (string?)null)
                    .SetProperty(d => d.WebPushAuth, (string?)null));
            return updated == 0 ? TypedResults.NotFound() : TypedResults.NoContent();
        });

        return api;
    }
}
