using System.Net;
using System.Threading.Channels;
using Chime.Api.Data;
using Lib.Net.Http.WebPush;
using Lib.Net.Http.WebPush.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Chime.Api.Services;

/// <summary>VAPID key pair (base64url, uncompressed P-256 public key and raw private key). Web Push is off when unset.</summary>
public sealed class WebPushOptions {
  public string? PublicKey { get; set; }
  public string? PrivateKey { get; set; }

  /// <summary>Contact for push services, as a mailto: or https: URL.</summary>
  public string Subject { get; set; } = "https://chime.ferg.al";

  public bool IsConfigured {
    get => !string.IsNullOrWhiteSpace(PublicKey) && !string.IsNullOrWhiteSpace(PrivateKey);
  }
}

public sealed record WebPushTarget(Guid DeviceId, string Endpoint, string P256dh, string Auth);

public enum WebPushResult {
  Sent,
  Gone,
  Failed
}

public interface IWebPushSender {
  Task<WebPushResult> SendAsync(WebPushTarget target, CancellationToken cancellationToken);
}

/// <summary>
///   Sends a content-free "your feed changed" signal; the extension then fetches its feed, so notification
///   content never passes through the push service.
/// </summary>
public sealed class WebPushSender(HttpClient http, IOptions<WebPushOptions> options, ILogger<WebPushSender> logger)
  : IWebPushSender {
  private readonly Lazy<PushServiceClient> _client = new(() => new PushServiceClient(http) {
    DefaultAuthentication = new VapidAuthentication(options.Value.PublicKey!, options.Value.PrivateKey!) {
      Subject = options.Value.Subject
    }
  });

  public async Task<WebPushResult> SendAsync(WebPushTarget target, CancellationToken cancellationToken) {
    var subscription = new PushSubscription {
      Endpoint = target.Endpoint,
      Keys = new Dictionary<string, string> {["p256dh"] = target.P256dh, ["auth"] = target.Auth}
    };
    var message = new PushMessage("{\"type\":\"changed\"}") {
      // Stale signals are worthless: the extension catches up by itself when it next starts.
      TimeToLive = 300,
      Urgency = PushMessageUrgency.High,
      // Collapses queued signals for an offline browser into one.
      Topic = "chime-changed"
    };

    try {
      await _client.Value.RequestPushMessageDeliveryAsync(subscription, message, cancellationToken);
      return WebPushResult.Sent;
    } catch (PushServiceClientException ex) when (ex.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone) {
      logger.LogInformation("Web Push subscription for device {DeviceId} has expired", target.DeviceId);
      return WebPushResult.Gone;
    } catch (Exception ex) when (ex is PushServiceClientException or HttpRequestException
                                 || ex is OperationCanceledException && !cancellationToken.IsCancellationRequested) {
      logger.LogWarning(ex, "Web Push delivery failed for device {DeviceId}", target.DeviceId);
      return WebPushResult.Failed;
    }
  }

  /// <summary>
  ///   The API POSTs to whatever endpoint a client registers, so only accept the browser vendors' push services.
  /// </summary>
  public static bool IsAllowedEndpoint(string endpoint) {
    return Uri.TryCreate(endpoint, UriKind.Absolute, out var uri)
           && uri.Scheme == Uri.UriSchemeHttps
           && uri.IsDefaultPort
           && string.IsNullOrEmpty(uri.UserInfo)
           && (uri.Host.Equals("fcm.googleapis.com", StringComparison.OrdinalIgnoreCase)
               || uri.Host.EndsWith(".push.services.mozilla.com", StringComparison.OrdinalIgnoreCase)
               || uri.Host.EndsWith(".notify.windows.com", StringComparison.OrdinalIgnoreCase)
               || uri.Host.EndsWith(".push.apple.com", StringComparison.OrdinalIgnoreCase));
  }
}

/// <summary>Queues "feed changed" signals so request handlers (e.g. the phone's upload) never wait on push services.</summary>
public interface IBrowserPushQueue {
  void FeedChanged(string userId);
}

public sealed class BrowserPushService(
  IServiceScopeFactory scopes,
  IOptions<WebPushOptions> options,
  ILogger<BrowserPushService> logger) : BackgroundService, IBrowserPushQueue {
  private readonly Channel<string> _queue = Channel.CreateBounded<string>(
    new BoundedChannelOptions(1000) {FullMode = BoundedChannelFullMode.DropOldest, SingleReader = true});

  public void FeedChanged(string userId) {
    // Dropping a signal only delays delivery until the extension's fallback poll.
    if (options.Value.IsConfigured) _queue.Writer.TryWrite(userId);
  }

  protected override async Task ExecuteAsync(CancellationToken stoppingToken) {
    await foreach (var userId in _queue.Reader.ReadAllAsync(stoppingToken)) {
      try {
        await NotifyAsync(userId, stoppingToken);
      } catch (Exception ex) when (ex is not OperationCanceledException || !stoppingToken.IsCancellationRequested) {
        logger.LogError(ex, "Web Push fan-out failed for user {UserId}", userId);
      }
    }
  }

  private async Task NotifyAsync(string userId, CancellationToken cancellationToken) {
    await using var scope = scopes.CreateAsyncScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var sender = scope.ServiceProvider.GetRequiredService<IWebPushSender>();
    var targets = await db.Devices.AsNoTracking()
      .Where(d => d.UserId == userId && d.WebPushEndpoint != null && d.WebPushP256dh != null && d.WebPushAuth != null)
      .Select(d => new WebPushTarget(d.Id, d.WebPushEndpoint!, d.WebPushP256dh!, d.WebPushAuth!))
      .ToListAsync(cancellationToken);

    foreach (var target in targets) {
      if (await sender.SendAsync(target, cancellationToken) != WebPushResult.Gone) continue;

      // Only clear it if the browser hasn't re-subscribed in the meantime.
      await db.Devices
        .Where(d => d.Id == target.DeviceId && d.WebPushEndpoint == target.Endpoint)
        .ExecuteUpdateAsync(s => s
          .SetProperty(d => d.WebPushEndpoint, (string?)null)
          .SetProperty(d => d.WebPushP256dh, (string?)null)
          .SetProperty(d => d.WebPushAuth, (string?)null), cancellationToken);
    }
  }
}
