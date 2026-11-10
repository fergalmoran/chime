using System.Security.Claims;
using Chime.Api.Contracts;
using Chime.Api.Data;
using Chime.Api.Services;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

namespace Chime.Api.Endpoints;

public static class DeviceEndpoints {
  public static RouteGroupBuilder MapDeviceEndpoints(this RouteGroupBuilder api) {
    var group = api.MapGroup("/devices");

    group.MapGet("/", async (ClaimsPrincipal principal, AppDbContext db) => {
      var userId = principal.GetUserId();
      var devices = await db.Devices.Where(d => d.UserId == userId).OrderBy(d => d.CreatedAt).ToListAsync();
      return TypedResults.Ok(devices.Select(DeviceDto.From));
    });

    group.MapPost("/", async (RegisterDeviceRequest request, ClaimsPrincipal principal, AppDbContext db) => {
      var device = new Device {
        UserId = principal.GetUserId(),
        Name = request.Name.Trim(),
        Platform = request.Platform,
        LastSeenAt = DateTimeOffset.UtcNow
      };
      db.Devices.Add(device);
      await db.SaveChangesAsync();
      return TypedResults.Created($"/api/devices/{device.Id}", DeviceDto.From(device));
    });

    group.MapDelete("/{id:guid}",
      async Task<Results<NoContent, NotFound>> (Guid id, ClaimsPrincipal principal, AppDbContext db) => {
        var userId = principal.GetUserId();
        var deleted = await db.Devices.Where(d => d.Id == id && d.UserId == userId).ExecuteDeleteAsync();
        return deleted == 0 ? TypedResults.NotFound() : TypedResults.NoContent();
      });

    group.MapPut("/{id:guid}/push-token", async Task<Results<NoContent, NotFound, ValidationProblem>> (
      Guid id, PushTokenRequest request, ClaimsPrincipal principal, AppDbContext db) => {
      var device = await db.Devices.SingleOrDefaultAsync(d => d.Id == id && d.UserId == principal.GetUserId());
      if (device is null) return TypedResults.NotFound();

      if (device.Platform != DevicePlatform.Android ||
          request.Token is not null && string.IsNullOrWhiteSpace(request.Token)) {
        return TypedResults.ValidationProblem(new Dictionary<string, string[]> {
          [nameof(request.Token)] =
            ["Only Android devices can register a non-empty push token (or null to unregister)."]
        });
      }

      await using var transaction = await db.Database.BeginTransactionAsync();
      if (request.Token is not null) {
        // An installation can switch accounts; don't leave its token on the previous device record.
        await db.Devices.Where(d => d.Id != id && d.PushToken == request.Token)
          .ExecuteUpdateAsync(s => s.SetProperty(d => d.PushToken, (string?)null));
      }

      device.PushToken = request.Token;
      device.LastSeenAt = DateTimeOffset.UtcNow;
      await db.SaveChangesAsync();
      await transaction.CommitAsync();
      return TypedResults.NoContent();
    });

    group.MapPost("/{id:guid}/links", async Task<Results<Accepted, NotFound, ValidationProblem, ProblemHttpResult>> (
      Guid id, SendLinkRequest request, ClaimsPrincipal principal, AppDbContext db, IMobileLinkSender sender,
      CancellationToken cancellationToken) => {
      if (!Uri.TryCreate(request.Url, UriKind.Absolute, out var url)
          || url.Scheme is not ("http" or "https") || string.IsNullOrEmpty(url.Host)
          || !string.IsNullOrEmpty(url.UserInfo) || url.AbsoluteUri.Length > 2048) {
        return TypedResults.ValidationProblem(new Dictionary<string, string[]> {
          [nameof(request.Url)] = ["Send an absolute HTTP or HTTPS URL without embedded credentials."]
        });
      }

      var device =
        await db.Devices.SingleOrDefaultAsync(d => d.Id == id && d.UserId == principal.GetUserId(), cancellationToken);
      if (device is null) return TypedResults.NotFound();
      if (device.Platform != DevicePlatform.Android || device.PushToken is null)
        return TypedResults.Problem("Open Chime on this phone and enable receiving links first.", statusCode: 409);
      if (!sender.IsConfigured)
        return TypedResults.Problem("Mobile push is not configured on the API. Configure Firebase first.",
          statusCode: 501);

      var result = await sender.SendAsync(device.Id, device.PushToken,
        string.IsNullOrWhiteSpace(request.Title) ? "Link from your desktop" : request.Title.Trim(),
        url.AbsoluteUri, cancellationToken);
      if (result == MobileLinkResult.Unregistered) {
        device.PushToken = null;
        await db.SaveChangesAsync(cancellationToken);
        return TypedResults.Problem(
          "This phone's push registration expired. Open Chime on the phone to register again.", statusCode: 409);
      }

      if (result == MobileLinkResult.NotConfigured)
        return TypedResults.Problem(
          "Firebase credentials are unavailable or invalid. Configure Firebase:CredentialsFilePath or Firebase:CredentialsJson in the API's .NET configuration, or workload identity, then restart the API.",
          statusCode: 503);

      return result == MobileLinkResult.Sent
        ? TypedResults.Accepted((string?)null)
        : TypedResults.Problem("The push provider could not accept the link. Please try again.", statusCode: 502);
    });

    return api;
  }
}
