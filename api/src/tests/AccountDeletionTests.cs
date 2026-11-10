using System.Net;
using System.Text.Json;
using Chime.Api.Contracts;
using Chime.Api.Data;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Chime.Api.Tests;

public class AccountDeletionTests(ApiFactory factory) : IClassFixture<ApiFactory> {
  private static readonly JsonSerializerOptions Json = ApiFactory.Json;

  private readonly Dictionary<string, string> _emails = [];

  [Fact]
  public async Task Deleting_an_account_removes_the_user_and_all_their_data() {
    var (client, _) = await SignInAsync("alice");
    var (bob, _) = await SignInAsync("bob");
    await SeedAsync(client);
    await SeedAsync(bob);
    var userId = (await client.GetFromJsonAsync<MeResponse>("/api/me", Json))!.Id;

    var response = await client.DeleteAsync("/api/account");
    Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

    using var scope = factory.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    Assert.False(await db.Users.AnyAsync(u => u.Id == userId));
    Assert.False(await db.Notifications.AnyAsync(n => n.UserId == userId));
    Assert.False(await db.Devices.AnyAsync(d => d.UserId == userId));
    Assert.False(await db.UserSettings.AnyAsync(s => s.UserId == userId));
    Assert.False(await db.UserLogins.AnyAsync(l => l.UserId == userId));

    // Other users are untouched.
    Assert.Single((await bob.GetFromJsonAsync<NotificationPage>("/api/notifications", Json))!.Items);
    Assert.Single((await bob.GetFromJsonAsync<List<DeviceDto>>("/api/devices", Json))!);
  }

  [Fact]
  public async Task Tokens_stop_working_once_the_account_is_deleted() {
    var (client, tokens) = await SignInAsync("carol");
    (await client.DeleteAsync("/api/account")).EnsureSuccessStatusCode();

    // The access token hasn't expired, but every authenticated endpoint now rejects it.
    Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/me")).StatusCode);
    Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/notifications")).StatusCode);
    var device = await client.PostAsJsonAsync("/api/devices",
      new RegisterDeviceRequest("Pixel", DevicePlatform.Android), Json);
    Assert.Equal(HttpStatusCode.Unauthorized, device.StatusCode);
    Assert.Equal(HttpStatusCode.Unauthorized, (await client.DeleteAsync("/api/account")).StatusCode);

    var refresh = await factory.CreateClient().PostAsJsonAsync("/api/auth/refresh", new {tokens.RefreshToken});
    Assert.Equal(HttpStatusCode.Unauthorized, refresh.StatusCode);

    await using var hub = new HubConnectionBuilder()
      .WithUrl(new Uri(factory.Server.BaseAddress, "/api/hubs/notifications"), options => {
        options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
        options.Transports = HttpTransportType.LongPolling;
        options.AccessTokenProvider = () => Task.FromResult<string?>(tokens.AccessToken);
      })
      .Build();
    var closed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    hub.Closed += _ => {
      closed.TrySetResult();
      return Task.CompletedTask;
    };
    // The server either refuses the handshake or aborts the connection straight after it.
    try { await hub.StartAsync(); } catch (Exception) { closed.TrySetResult(); }

    await closed.Task.WaitAsync(TimeSpan.FromSeconds(10));
    Assert.Equal(HubConnectionState.Disconnected, hub.State);
  }

  [Fact]
  public async Task Signing_in_again_after_deletion_starts_a_fresh_account() {
    var (client, _) = await SignInAsync("dave");
    await SeedAsync(client);
    var oldId = (await client.GetFromJsonAsync<MeResponse>("/api/me", Json))!.Id;
    (await client.DeleteAsync("/api/account")).EnsureSuccessStatusCode();

    var (again, _) = await SignInAsync("dave");
    var me = await again.GetFromJsonAsync<MeResponse>("/api/me", Json);
    Assert.NotEqual(oldId, me!.Id);
    Assert.Empty((await again.GetFromJsonAsync<NotificationPage>("/api/notifications", Json))!.Items);
    Assert.Empty((await again.GetFromJsonAsync<List<DeviceDto>>("/api/devices", Json))!);
  }

  /// <summary>Signs in as the same Google account each time it's called with the same name (within one test).</summary>
  private Task<(HttpClient Client, ApiFactory.TokenResponse Tokens)> SignInAsync(string name) {
    if (!_emails.TryGetValue(name, out var email)) {
      _emails[name] = email = $"{name}-{Guid.NewGuid():N}@example.com";
    }

    return factory.SignInWithGoogleAsync($"sub-{email}|{email}|true");
  }

  /// <summary>Gives the signed-in user a device, a notification and saved settings.</summary>
  private static async Task SeedAsync(HttpClient client) {
    var deviceResponse = await client.PostAsJsonAsync("/api/devices",
      new RegisterDeviceRequest("Pixel", DevicePlatform.Android), Json);
    var device = (await deviceResponse.Content.ReadFromJsonAsync<DeviceDto>(Json))!;
    (await client.PutAsJsonAsync($"/api/devices/{device.Id}/push-token", new PushTokenRequest("fid-123"), Json))
      .EnsureSuccessStatusCode();
    var notification = new CreateNotificationRequest(device.Id, "com.whatsapp", "WhatsApp",
      NotificationCategory.Message,
      "Mum", "Dinner at 7?", null, DateTimeOffset.UtcNow);
    (await client.PostAsJsonAsync("/api/notifications", notification, Json)).EnsureSuccessStatusCode();
    var settings = await client.GetFromJsonAsync<SettingsDto>("/api/settings", Json);
    (await client.PutAsJsonAsync("/api/settings", settings! with {RetentionDays = 30}, Json)).EnsureSuccessStatusCode();
  }
}
