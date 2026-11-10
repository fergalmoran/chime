using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Chime.Api.Contracts;
using Chime.Api.Data;
using Chime.Api.Services;

namespace Chime.Api.Tests;

public class MobileLinkTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Registered_android_phone_receives_the_link_without_exposing_its_token()
    {
        var sender = new FakeSender();
        using var app = WithSender(sender);
        var (client, _) = await app.CreateAuthenticatedClientAsync();
        var phone = await RegisterAsync(client);
        (await client.PutAsJsonAsync($"/api/devices/{phone.Id}/push-token", new { token = "private-token" })).EnsureSuccessStatusCode();

        var devices = await client.GetAsync("/api/devices");
        Assert.DoesNotContain("private-token", await devices.Content.ReadAsStringAsync());
        var listed = await devices.Content.ReadFromJsonAsync<List<DeviceDto>>(ApiFactory.Json);
        Assert.True(Assert.Single(listed!).CanReceiveLinks);
        var response = await client.PostAsJsonAsync($"/api/devices/{phone.Id}/links",
            new { url = "https://example.com/article#section", title = "Read this" });

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Equal((phone.Id, "private-token", "Read this", "https://example.com/article#section"), Assert.Single(sender.Sent));
        Assert.Empty((await client.GetFromJsonAsync<NotificationPage>("/api/notifications", ApiFactory.Json))!.Items);
    }

    [Fact]
    public async Task Device_ownership_is_required_for_both_registration_and_sending()
    {
        var sender = new FakeSender();
        using var app = WithSender(sender);
        var (alice, _) = await app.CreateAuthenticatedClientAsync();
        var (bob, _) = await app.CreateAuthenticatedClientAsync();
        var phone = await RegisterAsync(alice);
        Assert.Equal(HttpStatusCode.NotFound,
            (await bob.PutAsJsonAsync($"/api/devices/{phone.Id}/push-token", new { token = "stolen-token" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await bob.PostAsJsonAsync($"/api/devices/{phone.Id}/links", new { url = "https://example.com" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await app.CreateClient().PostAsJsonAsync($"/api/devices/{phone.Id}/links", new { url = "https://example.com" })).StatusCode);
        Assert.Empty(sender.Sent);
    }

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("file:///etc/passwd")]
    [InlineData("https://user:password@example.com")]
    [InlineData("/relative")]
    public async Task Non_web_or_credential_bearing_urls_are_rejected(string url)
    {
        var (client, _) = await factory.CreateAuthenticatedClientAsync();
        var phone = await RegisterAsync(client);
        var response = await client.PostAsJsonAsync($"/api/devices/{phone.Id}/links", new { url });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Unready_phones_and_unconfigured_push_return_actionable_errors()
    {
        using var app = WithSender(new FakeSender(configured: false));
        var (client, _) = await app.CreateAuthenticatedClientAsync();
        var phone = await RegisterAsync(client);
        var response = await client.PostAsJsonAsync($"/api/devices/{phone.Id}/links", new { url = "https://example.com" });
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);

        (await client.PutAsJsonAsync($"/api/devices/{phone.Id}/push-token", new { token = "phone-token" })).EnsureSuccessStatusCode();
        response = await client.PostAsJsonAsync($"/api/devices/{phone.Id}/links", new { url = "https://example.com" });
        Assert.Equal(HttpStatusCode.NotImplemented, response.StatusCode);
    }

    [Theory]
    [InlineData(MobileLinkResult.Unregistered, HttpStatusCode.Conflict, false)]
    [InlineData(MobileLinkResult.Failed, HttpStatusCode.BadGateway, true)]
    [InlineData(MobileLinkResult.NotConfigured, HttpStatusCode.ServiceUnavailable, true)]
    public async Task Provider_failure_is_not_reported_as_success(MobileLinkResult result, HttpStatusCode status, bool stillRegistered)
    {
        using var app = WithSender(new FakeSender(result: result));
        var (client, _) = await app.CreateAuthenticatedClientAsync();
        var phone = await RegisterAsync(client);
        (await client.PutAsJsonAsync($"/api/devices/{phone.Id}/push-token", new { token = "phone-token" })).EnsureSuccessStatusCode();
        var response = await client.PostAsJsonAsync($"/api/devices/{phone.Id}/links", new { url = "https://example.com" });
        Assert.Equal(status, response.StatusCode);
        var devices = await client.GetFromJsonAsync<List<DeviceDto>>("/api/devices", ApiFactory.Json);
        Assert.Equal(stillRegistered, Assert.Single(devices!).CanReceiveLinks);
    }

    [Fact]
    public async Task Token_moves_to_new_device_on_account_switch_and_can_be_unregistered()
    {
        var (alice, _) = await factory.CreateAuthenticatedClientAsync();
        var (bob, _) = await factory.CreateAuthenticatedClientAsync();
        var first = await RegisterAsync(alice);
        var second = await RegisterAsync(bob);
        (await alice.PutAsJsonAsync($"/api/devices/{first.Id}/push-token", new { token = "same-installation" })).EnsureSuccessStatusCode();
        (await bob.PutAsJsonAsync($"/api/devices/{second.Id}/push-token", new { token = "same-installation" })).EnsureSuccessStatusCode();

        Assert.False(Assert.Single((await alice.GetFromJsonAsync<List<DeviceDto>>("/api/devices", ApiFactory.Json))!).CanReceiveLinks);
        Assert.True(Assert.Single((await bob.GetFromJsonAsync<List<DeviceDto>>("/api/devices", ApiFactory.Json))!).CanReceiveLinks);
        (await bob.PutAsJsonAsync($"/api/devices/{second.Id}/push-token", new PushTokenRequest(null))).EnsureSuccessStatusCode();
        Assert.False(Assert.Single((await bob.GetFromJsonAsync<List<DeviceDto>>("/api/devices", ApiFactory.Json))!).CanReceiveLinks);
    }

    private static ApiFactory WithSender(IMobileLinkSender sender) => new MobileApiFactory(sender);

    private sealed class MobileApiFactory(IMobileLinkSender sender) : ApiFactory
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureTestServices(services => services.AddSingleton(sender));
        }
    }

    private static async Task<DeviceDto> RegisterAsync(HttpClient client)
    {
        var response = await client.PostAsJsonAsync("/api/devices",
            new RegisterDeviceRequest("My phone", DevicePlatform.Android), ApiFactory.Json);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<DeviceDto>(ApiFactory.Json))!;
    }

    private sealed class FakeSender(bool configured = true, MobileLinkResult result = MobileLinkResult.Sent) : IMobileLinkSender
    {
        public bool IsConfigured => configured;
        public List<(Guid DeviceId, string Token, string Title, string Url)> Sent { get; } = [];
        public Task<MobileLinkResult> SendAsync(Guid deviceId, string token, string title, string url, CancellationToken cancellationToken)
        {
            Sent.Add((deviceId, token, title, url));
            return Task.FromResult(result);
        }
    }
}
