using System.ComponentModel.DataAnnotations;
using Chime.Api.Data;

namespace Chime.Api.Contracts;

public record MeResponse(string Id, string Email, DateTimeOffset CreatedAt);

public record DeviceDto(
  Guid Id,
  string Name,
  DevicePlatform Platform,
  DateTimeOffset CreatedAt,
  DateTimeOffset? LastSeenAt,
  bool CanReceiveLinks = false) {
  public static DeviceDto From(Device d) {
    return new DeviceDto(d.Id, d.Name, d.Platform, d.CreatedAt, d.LastSeenAt,
      d.Platform == DevicePlatform.Android && d.PushToken is not null);
  }
}

public record PushTokenRequest(
  [StringLength(4096, MinimumLength = 1)]
  string? Token);

public record WebPushSubscriptionRequest(
  [Required] [StringLength(2048, MinimumLength = 1)]
  string Endpoint,
  [Required] [StringLength(200, MinimumLength = 1)]
  string P256dh,
  [Required] [StringLength(100, MinimumLength = 1)]
  string Auth);

public record WebPushKeyResponse(string PublicKey);

public record SendLinkRequest(
  [Required] [StringLength(2048, MinimumLength = 1)]
  string Url,
  [StringLength(200)] string? Title);

public record RegisterDeviceRequest(
  [Required] [StringLength(100, MinimumLength = 1)]
  string Name,
  DevicePlatform Platform);

public record CreateNotificationRequest(
  Guid? DeviceId,
  [Required] [StringLength(200, MinimumLength = 1)]
  string AppId,
  [StringLength(200)] string? AppName,
  NotificationCategory Category,
  [StringLength(500)] string? Title,
  [StringLength(4000)] string? Body,
  [StringLength(200)] string? ExternalKey,
  DateTimeOffset? PostedAt);

public record NotificationDto(
  Guid Id,
  Guid? SourceDeviceId,
  string AppId,
  string? AppName,
  NotificationCategory Category,
  string? Title,
  string? Body,
  DateTimeOffset PostedAt,
  DateTimeOffset ReceivedAt,
  DateTimeOffset? DismissedAt) {
  public static NotificationDto From(Notification n) {
    return new NotificationDto(n.Id, n.SourceDeviceId, n.AppId, n.AppName, n.Category, n.Title, n.Body, n.PostedAt,
      n.ReceivedAt,
      n.DismissedAt);
  }
}

public record NotificationPage(IReadOnlyList<NotificationDto> Items, DateTimeOffset? NextBefore);

public record SettingsDto(
  bool SyncEnabled,
  bool IncludeMessageBody,
  [Range(1, 365)] int RetentionDays,
  List<string> MutedApps,
  List<NotificationCategory> EnabledCategories) {
  public static SettingsDto From(UserSettings s) {
    return new SettingsDto(s.SyncEnabled, s.IncludeMessageBody, s.RetentionDays, s.MutedApps, s.EnabledCategories);
  }
}
