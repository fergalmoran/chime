using System.Net;
using System.Text.Json;
using Chime.Api.Contracts;
using Chime.Api.Data;

namespace Chime.Api.Tests;

/// <summary>Request builders and small HTTP helpers shared by the endpoint tests.</summary>
static internal class TestData {
  public static readonly JsonSerializerOptions Json = ApiFactory.Json;

  public static CreateNotificationRequest Notification(Guid? deviceId = null, string appId = "com.whatsapp",
    NotificationCategory category = NotificationCategory.Message, string? externalKey = null) {
    return new CreateNotificationRequest(deviceId, appId, "WhatsApp", category, "Alice", "Hello!", externalKey,
      DateTimeOffset.UtcNow);
  }

  public static async Task<DeviceDto> RegisterDeviceAsync(this HttpClient client, string name = "Pixel",
    DevicePlatform platform = DevicePlatform.Android) {
    var response = await client.PostAsJsonAsync("/api/devices", new RegisterDeviceRequest(name, platform), Json);
    Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    return (await response.Content.ReadFromJsonAsync<DeviceDto>(Json))!;
  }

  public static async Task<NotificationDto> PostNotificationAsync(this HttpClient client,
    CreateNotificationRequest request) {
    var response = await client.PostAsJsonAsync("/api/notifications", request, Json);
    Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    return (await response.Content.ReadFromJsonAsync<NotificationDto>(Json))!;
  }

  public static async Task<NotificationPage> GetNotificationsAsync(this HttpClient client, string query = "") {
    return (await client.GetFromJsonAsync<NotificationPage>($"/api/notifications{query}", Json))!;
  }

  public static async Task<SettingsDto> GetSettingsAsync(this HttpClient client) {
    return (await client.GetFromJsonAsync<SettingsDto>("/api/settings", Json))!;
  }

  public static async Task<SettingsDto> PutSettingsAsync(this HttpClient client, SettingsDto settings) {
    var response = await client.PutAsJsonAsync("/api/settings", settings, Json);
    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    return (await response.Content.ReadFromJsonAsync<SettingsDto>(Json))!;
  }
}
