using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;
using Chime.Api.Contracts;
using Chime.Api.Data;

namespace Chime.Api.Tests;

public class NotificationFlowTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly System.Text.Json.JsonSerializerOptions Json = ApiFactory.Json;

    [Fact]
    public async Task Api_requires_authentication()
    {
        var response = await factory.CreateClient().GetAsync("/api/notifications");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Device_can_push_notification_which_is_listed_deduplicated_and_dismissed()
    {
        var (client, _) = await factory.CreateAuthenticatedClientAsync();
        var device = await RegisterDeviceAsync(client);

        var request = NewNotification(device.Id, externalKey: "k-1");
        var created = await client.PostAsJsonAsync("/api/notifications", request, Json);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var dto = await created.Content.ReadFromJsonAsync<NotificationDto>(Json);
        Assert.Equal(NotificationCategory.Message, dto!.Category);
        Assert.Equal(device.Id, dto.SourceDeviceId);

        var duplicate = await client.PostAsJsonAsync("/api/notifications", request, Json);
        Assert.Equal(HttpStatusCode.OK, duplicate.StatusCode);

        var page = await client.GetFromJsonAsync<NotificationPage>("/api/notifications", Json);
        Assert.Equal(dto.Id, Assert.Single(page!.Items).Id);

        var dismiss = await client.PostAsync($"/api/notifications/{dto.Id}/dismiss", null);
        Assert.Equal(HttpStatusCode.NoContent, dismiss.StatusCode);
        page = await client.GetFromJsonAsync<NotificationPage>("/api/notifications", Json);
        Assert.Empty(page!.Items);
    }

    [Fact]
    public async Task Notifications_from_muted_apps_or_disabled_categories_are_not_stored()
    {
        var (client, _) = await factory.CreateAuthenticatedClientAsync();
        var settings = await client.GetFromJsonAsync<SettingsDto>("/api/settings", Json);
        var update = settings! with { MutedApps = ["com.whatsapp"], EnabledCategories = [NotificationCategory.Sms] };
        (await client.PutAsJsonAsync("/api/settings", update, Json)).EnsureSuccessStatusCode();

        var muted = await client.PostAsJsonAsync("/api/notifications", NewNotification(null), Json);
        var wrongCategory = await client.PostAsJsonAsync("/api/notifications",
            NewNotification(null) with { AppId = "com.google.android.gm", Category = NotificationCategory.Email }, Json);

        Assert.Equal(HttpStatusCode.NoContent, muted.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, wrongCategory.StatusCode);
        var page = await client.GetFromJsonAsync<NotificationPage>("/api/notifications", Json);
        Assert.Empty(page!.Items);
    }

    [Fact]
    public async Task Users_cannot_use_or_see_other_users_devices_and_notifications()
    {
        var (alice, _) = await factory.CreateAuthenticatedClientAsync();
        var (bob, _) = await factory.CreateAuthenticatedClientAsync();
        var aliceDevice = await RegisterDeviceAsync(alice);
        (await alice.PostAsJsonAsync("/api/notifications", NewNotification(aliceDevice.Id), Json)).EnsureSuccessStatusCode();

        var spoofed = await bob.PostAsJsonAsync("/api/notifications", NewNotification(aliceDevice.Id), Json);
        Assert.Equal(HttpStatusCode.BadRequest, spoofed.StatusCode);

        var bobPage = await bob.GetFromJsonAsync<NotificationPage>("/api/notifications", Json);
        Assert.Empty(bobPage!.Items);
        Assert.Empty((await bob.GetFromJsonAsync<List<DeviceDto>>("/api/devices", Json))!);
    }

    [Fact]
    public async Task Invalid_payload_is_rejected()
    {
        var (client, _) = await factory.CreateAuthenticatedClientAsync();
        var response = await client.PostAsJsonAsync("/api/notifications", NewNotification(null) with { AppId = "" }, Json);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Hub_clients_receive_new_notifications_in_real_time()
    {
        var (client, token) = await factory.CreateAuthenticatedClientAsync();
        var received = new TaskCompletionSource<NotificationDto>(TaskCreationOptions.RunContinuationsAsynchronously);

        await using var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(factory.Server.BaseAddress, "/api/hubs/notifications"), options =>
            {
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
                options.Transports = Microsoft.AspNetCore.Http.Connections.HttpTransportType.LongPolling;
                options.AccessTokenProvider = () => Task.FromResult<string?>(token);
            })
            .AddJsonProtocol(o => o.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter()))
            .Build();
        connection.On<NotificationDto>("NotificationReceived", n => received.TrySetResult(n));
        await connection.StartAsync();

        (await client.PostAsJsonAsync("/api/notifications", NewNotification(null), Json)).EnsureSuccessStatusCode();

        var notification = await received.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal("com.whatsapp", notification.AppId);
    }

    [Fact]
    public async Task Retention_purges_expired_notifications()
    {
        var (client, _) = await factory.CreateAuthenticatedClientAsync();
        (await client.PostAsJsonAsync("/api/notifications", NewNotification(null) with { AppId = "com.retention.test" }, Json))
            .EnsureSuccessStatusCode();

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            foreach (var n in db.Notifications.Where(n => n.AppId == "com.retention.test")) n.ReceivedAt = DateTimeOffset.UtcNow.AddDays(-30);
            await db.SaveChangesAsync();
        }

        var purged = await ActivatorUtilities.CreateInstance<Services.RetentionService>(factory.Services).PurgeAsync();

        Assert.True(purged >= 1);
        var page = await client.GetFromJsonAsync<NotificationPage>("/api/notifications", Json);
        Assert.Empty(page!.Items);
    }

    private static async Task<DeviceDto> RegisterDeviceAsync(HttpClient client)
    {
        var response = await client.PostAsJsonAsync("/api/devices", new RegisterDeviceRequest("Pixel", DevicePlatform.Android), Json);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<DeviceDto>(Json))!;
    }

    private static CreateNotificationRequest NewNotification(Guid? deviceId, string? externalKey = null) =>
        new(deviceId, "com.whatsapp", "WhatsApp", NotificationCategory.Message, "Alice", "Hello!", externalKey, DateTimeOffset.UtcNow);
}
