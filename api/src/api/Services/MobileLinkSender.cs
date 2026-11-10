using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;
using Google.Apis.Auth.OAuth2;
using Microsoft.Extensions.Options;

namespace Chime.Api.Services;

public sealed class FirebaseOptions {
  public string ProjectId { get; set; } = "";
  public string? CredentialsFilePath { get; set; }
  public string? CredentialsJson { get; set; }
}

public enum MobileLinkResult {
  Sent,
  Unregistered,
  Failed,
  NotConfigured
}

public interface IMobileLinkSender {
  bool IsConfigured { get; }

  Task<MobileLinkResult> SendAsync(Guid deviceId, string token, string title, string url,
    CancellationToken cancellationToken);
}

public sealed class MobileLinkSender(
  IHttpClientFactory clients,
  IOptions<FirebaseOptions> options,
  IHostEnvironment environment,
  ILogger<MobileLinkSender> logger) : IMobileLinkSender {
  private readonly Lazy<Task<GoogleCredential>> _credential = new(() =>
    CreateCredentialAsync(options.Value, environment.ContentRootPath));

  public bool IsConfigured {
    get => !string.IsNullOrWhiteSpace(options.Value.ProjectId);
  }

  public async Task<MobileLinkResult> SendAsync(Guid deviceId, string token, string title, string url,
    CancellationToken cancellationToken) {
    GoogleCredential credential;
    try {
      credential = await _credential.Value.WaitAsync(cancellationToken);
    } catch (OptionsValidationException ex) {
      logger.LogError("Firebase credential configuration is invalid: {Reason}", ex.Message);
      return MobileLinkResult.NotConfigured;
    }

    var accessToken =
      await credential.UnderlyingCredential.GetAccessTokenForRequestAsync(cancellationToken: cancellationToken);
    using var request = new HttpRequestMessage(HttpMethod.Post,
      $"https://fcm.googleapis.com/v1/projects/{Uri.EscapeDataString(options.Value.ProjectId)}/messages:send");
    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
    request.Content = JsonContent.Create(new {
      message = new {
        fid = token,
        // Data-only lets Android check the signed-in device before displaying private links.
        data = new {type = "web-link", deviceId = deviceId.ToString(), title, url},
        android = new {priority = "high", ttl = "86400s"}
      }
    });

    try {
      using var response = await clients.CreateClient("Firebase").SendAsync(request, cancellationToken);
      if (response.IsSuccessStatusCode) return MobileLinkResult.Sent;

      var body = await response.Content.ReadAsStringAsync(cancellationToken);
      using var error = JsonDocument.Parse(body);
      if (error.RootElement.TryGetProperty("error", out var details)
          && details.TryGetProperty("details", out var entries)
          && entries.ValueKind == JsonValueKind.Array
          && entries.EnumerateArray().Any(e =>
            e.TryGetProperty("errorCode", out var code) && code.GetString() == "UNREGISTERED")) {
        logger.LogWarning("FCM token is no longer registered for device {DeviceId}", deviceId);
        return MobileLinkResult.Unregistered;
      }

      logger.LogError("FCM rejected link delivery for device {DeviceId}: HTTP {StatusCode}", deviceId,
        (int)response.StatusCode);
      return MobileLinkResult.Failed;
    } catch (HttpRequestException ex) {
      logger.LogError(ex, "FCM link delivery failed for device {DeviceId}", deviceId);
      return MobileLinkResult.Failed;
    } catch (JsonException ex) {
      logger.LogError(ex, "FCM returned an invalid error response for device {DeviceId}", deviceId);
      return MobileLinkResult.Failed;
    } catch (OperationCanceledException ex) when (!cancellationToken.IsCancellationRequested) {
      logger.LogError(ex, "FCM link delivery timed out for device {DeviceId}", deviceId);
      return MobileLinkResult.Failed;
    }
  }

  static internal async Task<GoogleCredential> CreateCredentialAsync(FirebaseOptions options, string contentRootPath) {
    var json = options.CredentialsJson;
    var source = "Firebase:CredentialsJson";
    if (options.CredentialsFilePath is { } path) {
      if (json is not null) {
        throw new OptionsValidationException(nameof(FirebaseOptions), typeof(FirebaseOptions),
          ["Configure either Firebase:CredentialsFilePath or Firebase:CredentialsJson, not both."]);
      }

      source = "Firebase:CredentialsFilePath";
      try {
        json = await File.ReadAllTextAsync(Path.GetFullPath(path, contentRootPath));
      } catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException
                                     or NotSupportedException) {
        throw new OptionsValidationException(nameof(FirebaseOptions), typeof(FirebaseOptions),
        [
          "Firebase:CredentialsFilePath must refer to a readable service-account JSON file; relative paths resolve from the API content root."
        ]);
      }
    }

    GoogleCredential credential;
    if (json is not null) {
      try {
        credential = CredentialFactory.FromJson<ServiceAccountCredential>(json).ToGoogleCredential();
      } catch (Exception ex) when (ex is ArgumentException or InvalidOperationException
                                     or Newtonsoft.Json.JsonException or CryptographicException or FormatException) {
        // Parser exceptions may contain credential content; don't retain or log them.
        throw new OptionsValidationException(nameof(FirebaseOptions), typeof(FirebaseOptions),
          [$"{source} must supply valid service-account JSON."]);
      }
    } else {
      try {
        credential = await GoogleCredential.GetApplicationDefaultAsync();
      } catch (InvalidOperationException) {
        throw new OptionsValidationException(nameof(FirebaseOptions), typeof(FirebaseOptions),
        [
          "Set Firebase:CredentialsFilePath or Firebase:CredentialsJson in the API's .NET configuration, or configure Application Default Credentials/workload identity."
        ]);
      }
    }

    return credential.CreateScoped("https://www.googleapis.com/auth/firebase.messaging");
  }
}
