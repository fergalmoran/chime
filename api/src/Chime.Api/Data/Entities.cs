using Microsoft.AspNetCore.Identity;

namespace Chime.Api.Data;

public class AppUser : IdentityUser
{
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public UserSettings? Settings { get; set; }
    public List<Device> Devices { get; set; } = [];
}

public enum DevicePlatform
{
    Android,
    Browser,
    Web,
}

public class Device
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public required string UserId { get; set; }
    public AppUser? User { get; set; }
    public required string Name { get; set; }
    public DevicePlatform Platform { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? LastSeenAt { get; set; }
    public string? PushToken { get; set; }
}

public enum NotificationCategory
{
    Other,
    Message,
    Sms,
    Email,
    Call,
}

public class Notification
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public required string UserId { get; set; }
    public Guid? SourceDeviceId { get; set; }
    public Device? SourceDevice { get; set; }

    /// <summary>Package name / identifier of the originating app (e.g. com.whatsapp).</summary>
    public required string AppId { get; set; }
    public string? AppName { get; set; }
    public NotificationCategory Category { get; set; }
    public string? Title { get; set; }
    public string? Body { get; set; }

    /// <summary>Client-side key used to de-duplicate retried uploads.</summary>
    public string? ExternalKey { get; set; }
    public DateTimeOffset PostedAt { get; set; }
    public DateTimeOffset ReceivedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? DismissedAt { get; set; }
}

public class UserSettings
{
    public required string UserId { get; set; }
    public bool SyncEnabled { get; set; } = true;
    public bool IncludeMessageBody { get; set; } = true;
    public int RetentionDays { get; set; } = 7;

    /// <summary>App ids that should never be synced.</summary>
    public List<string> MutedApps { get; set; } = [];
    public List<NotificationCategory> EnabledCategories { get; set; } =
        [NotificationCategory.Message, NotificationCategory.Sms, NotificationCategory.Email, NotificationCategory.Call];
}
