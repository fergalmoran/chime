using System.Net;
using System.Threading.Channels;
using Chime.Api.Contracts;
using Chime.Api.Data;
using Chime.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Chime.Api.Tests;

public class WebPushTests(ApiFactory factory) : IClassFixture<ApiFactory> {
  private const string ChromeEndpoint = "https://fcm.googleapis.com/fcm/send/abc123";

  [Fact]
  public async Task Key_is_only_offered_when_web_push_is_configured() {
    var (unconfigured, _) = await factory.CreateAuthenticatedClientAsync();
    Assert.Equal(HttpStatusCode.NotFound, (await unconfigured.GetAsync("/api/web-push/key")).StatusCode);

    using var app = new PushApiFactory(new FakeSender());
    var (client, _) = await app.CreateAuthenticatedClientAsync();
    var key = await client.GetFromJsonAsync<WebPushKeyResponse>("/api/web-push/key", ApiFactory.Json);
    Assert.Equal("test-public-key", key!.PublicKey);
  }

  [Fact]
  public async Task New_and_dismissed_notifications_signal_only_the_owners_subscribed_browsers() {
    var sender = new FakeSender();
    using var app = new PushApiFactory(sender);
    var (alice, _) = await app.CreateAuthenticatedClientAsync();
    var (bob, _) = await app.CreateAuthenticatedClientAsync();
    var aliceBrowser = await RegisterAsync(alice, DevicePlatform.Browser);
    await RegisterAsync(alice, DevicePlatform.Browser); // never subscribes
    var bobBrowser = await RegisterAsync(bob, DevicePlatform.Browser);
    await SubscribeAsync(alice, aliceBrowser.Id, ChromeEndpoint);
    await SubscribeAsync(bob, bobBrowser.Id, "https://fcm.googleapis.com/fcm/send/bob");

    var created = await alice.PostAsJsonAsync("/api/notifications",
      new {appId = "com.whatsapp", category = "Message", title = "Hi"}, ApiFactory.Json);
    created.EnsureSuccessStatusCode();
    var target = await sender.NextAsync();
    Assert.Equal(new WebPushTarget(aliceBrowser.Id, ChromeEndpoint, "p256dh-key", "auth-secret"), target);

    var notification = await created.Content.ReadFromJsonAsync<NotificationDto>(ApiFactory.Json);
    (await alice.PostAsync($"/api/notifications/{notification!.Id}/dismiss", null)).EnsureSuccessStatusCode();
    Assert.Equal(aliceBrowser.Id, (await sender.NextAsync()).DeviceId);
    Assert.False(sender.HasPending);
  }

  [Fact]
  public async Task Expired_subscriptions_are_cleared() {
    var sender = new FakeSender(WebPushResult.Gone);
    using var app = new PushApiFactory(sender);
    var (client, _) = await app.CreateAuthenticatedClientAsync();
    var browser = await RegisterAsync(client, DevicePlatform.Browser);
    await SubscribeAsync(client, browser.Id, ChromeEndpoint);

    (await client.PostAsJsonAsync("/api/notifications",
      new {appId = "com.whatsapp", category = "Message"}, ApiFactory.Json)).EnsureSuccessStatusCode();
    await sender.NextAsync();

    await using var scope = app.Services.CreateAsyncScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var deadline = DateTime.UtcNow.AddSeconds(5);
    string? endpoint;
    do {
      endpoint = await db.Devices.Where(d => d.Id == browser.Id).Select(d => d.WebPushEndpoint).SingleAsync();
      if (endpoint is null) break;

      await Task.Delay(50);
    } while (DateTime.UtcNow < deadline);

    Assert.Null(endpoint);
  }

  [Theory]
  [InlineData("http://fcm.googleapis.com/fcm/send/abc")]
  [InlineData("https://fcm.googleapis.com:8443/fcm/send/abc")]
  [InlineData("https://evil.example.com/fcm.googleapis.com")]
  [InlineData("https://fcm.googleapis.com.evil.example.com/x")]
  [InlineData("https://169.254.169.254/latest/meta-data")]
  [InlineData("not a url")]
  public async Task Only_browser_push_service_endpoints_are_accepted(string endpoint) {
    var (client, _) = await factory.CreateAuthenticatedClientAsync();
    var browser = await RegisterAsync(client, DevicePlatform.Browser);
    var response = await client.PutAsJsonAsync($"/api/devices/{browser.Id}/web-push",
      new WebPushSubscriptionRequest(endpoint, "p256dh-key", "auth-secret"), ApiFactory.Json);
    Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
  }

  [Fact]
  public async Task Subscriptions_require_an_owned_browser_device() {
    var (alice, _) = await factory.CreateAuthenticatedClientAsync();
    var (bob, _) = await factory.CreateAuthenticatedClientAsync();
    var browser = await RegisterAsync(alice, DevicePlatform.Browser);
    var phone = await RegisterAsync(alice, DevicePlatform.Android);
    var request = new WebPushSubscriptionRequest(ChromeEndpoint, "p256dh-key", "auth-secret");

    Assert.Equal(HttpStatusCode.NotFound,
      (await bob.PutAsJsonAsync($"/api/devices/{browser.Id}/web-push", request, ApiFactory.Json)).StatusCode);
    Assert.Equal(HttpStatusCode.NotFound, (await bob.DeleteAsync($"/api/devices/{browser.Id}/web-push")).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest,
      (await alice.PutAsJsonAsync($"/api/devices/{phone.Id}/web-push", request, ApiFactory.Json)).StatusCode);
    Assert.Equal(HttpStatusCode.NoContent,
      (await alice.PutAsJsonAsync($"/api/devices/{browser.Id}/web-push", request, ApiFactory.Json)).StatusCode);
    Assert.Equal(HttpStatusCode.NoContent, (await alice.DeleteAsync($"/api/devices/{browser.Id}/web-push")).StatusCode);
  }

  private static async Task<DeviceDto> RegisterAsync(HttpClient client, DevicePlatform platform) {
    var response =
      await client.PostAsJsonAsync("/api/devices", new RegisterDeviceRequest("Device", platform), ApiFactory.Json);
    response.EnsureSuccessStatusCode();
    return (await response.Content.ReadFromJsonAsync<DeviceDto>(ApiFactory.Json))!;
  }

  private static async Task SubscribeAsync(HttpClient client, Guid deviceId, string endpoint) {
    (await client.PutAsJsonAsync($"/api/devices/{deviceId}/web-push",
        new WebPushSubscriptionRequest(endpoint, "p256dh-key", "auth-secret"), ApiFactory.Json))
      .EnsureSuccessStatusCode();
  }

  private sealed class PushApiFactory(IWebPushSender sender) : ApiFactory {
    protected override void ConfigureWebHost(IWebHostBuilder builder) {
      base.ConfigureWebHost(builder);
      builder.UseSetting("WebPush:PublicKey", "test-public-key");
      builder.UseSetting("WebPush:PrivateKey", "test-private-key");
      builder.ConfigureTestServices(services => services.AddScoped(_ => sender));
    }
  }

  private sealed class FakeSender(WebPushResult result = WebPushResult.Sent) : IWebPushSender {
    private readonly Channel<WebPushTarget> _sent = Channel.CreateUnbounded<WebPushTarget>();

    public bool HasPending {
      get => _sent.Reader.Count > 0;
    }

    public Task<WebPushResult> SendAsync(WebPushTarget target, CancellationToken cancellationToken) {
      _sent.Writer.TryWrite(target);
      return Task.FromResult(result);
    }

    public async Task<WebPushTarget> NextAsync() {
      return await _sent.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(5));
    }
  }
}
