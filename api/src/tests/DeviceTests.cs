using System.Net;
using Chime.Api.Contracts;
using Chime.Api.Data;

namespace Chime.Api.Tests;

public class DeviceTests(ApiFactory factory) : IClassFixture<ApiFactory> {
  [Fact]
  public async Task Registered_devices_are_listed_oldest_first_with_trimmed_names() {
    var (client, _) = await factory.CreateAuthenticatedClientAsync();

    var phone = await client.RegisterDeviceAsync("  Pixel 9  ");
    var browser = await client.RegisterDeviceAsync("Chrome", DevicePlatform.Browser);

    Assert.Equal("Pixel 9", phone.Name);
    Assert.NotNull(phone.LastSeenAt);
    Assert.False(phone.CanReceiveLinks);
    var devices = await client.GetFromJsonAsync<List<DeviceDto>>("/api/devices", TestData.Json);
    Assert.Equal([phone.Id, browser.Id], devices!.Select(d => d.Id));
    Assert.Equal(DevicePlatform.Browser, devices[1].Platform);
  }

  [Theory]
  [InlineData("")]
  [InlineData(
    "This name is far too long for a device: it goes on and on and on, well past the one hundred character limit")]
  public async Task Device_names_must_be_1_to_100_characters(string name) {
    var (client, _) = await factory.CreateAuthenticatedClientAsync();

    var response = await client.PostAsJsonAsync("/api/devices", new RegisterDeviceRequest(name, DevicePlatform.Android),
      TestData.Json);

    Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
  }

  [Fact]
  public async Task Uploading_a_notification_marks_the_device_as_seen() {
    var (client, _) = await factory.CreateAuthenticatedClientAsync();
    var device = await client.RegisterDeviceAsync();
    await Task.Delay(20);

    await client.PostNotificationAsync(TestData.Notification(device.Id));

    var seen = Assert.Single((await client.GetFromJsonAsync<List<DeviceDto>>("/api/devices", TestData.Json))!);
    Assert.True(seen.LastSeenAt > device.LastSeenAt);
  }

  [Fact]
  public async Task Removing_a_device_keeps_the_notifications_it_sent() {
    var (client, _) = await factory.CreateAuthenticatedClientAsync();
    var device = await client.RegisterDeviceAsync();
    var sent = await client.PostNotificationAsync(TestData.Notification(device.Id));

    var delete = await client.DeleteAsync($"/api/devices/{device.Id}");

    Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);
    Assert.Empty((await client.GetFromJsonAsync<List<DeviceDto>>("/api/devices", TestData.Json))!);
    var kept = Assert.Single((await client.GetNotificationsAsync()).Items);
    Assert.Equal(sent.Id, kept.Id);
    Assert.Null(kept.SourceDeviceId);
  }

  [Fact]
  public async Task Removed_devices_can_no_longer_upload() {
    var (client, _) = await factory.CreateAuthenticatedClientAsync();
    var device = await client.RegisterDeviceAsync();
    (await client.DeleteAsync($"/api/devices/{device.Id}")).EnsureSuccessStatusCode();

    var response = await client.PostAsJsonAsync("/api/notifications", TestData.Notification(device.Id), TestData.Json);

    Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
  }

  [Fact]
  public async Task Removing_an_unknown_or_someone_elses_device_is_not_found() {
    var (alice, _) = await factory.CreateAuthenticatedClientAsync();
    var (bob, _) = await factory.CreateAuthenticatedClientAsync();
    var aliceDevice = await alice.RegisterDeviceAsync();

    Assert.Equal(HttpStatusCode.NotFound, (await bob.DeleteAsync($"/api/devices/{aliceDevice.Id}")).StatusCode);
    Assert.Equal(HttpStatusCode.NotFound, (await alice.DeleteAsync($"/api/devices/{Guid.NewGuid()}")).StatusCode);
    Assert.Single((await alice.GetFromJsonAsync<List<DeviceDto>>("/api/devices", TestData.Json))!);
  }

  [Fact]
  public async Task Only_android_devices_can_register_a_push_token() {
    var (client, _) = await factory.CreateAuthenticatedClientAsync();
    var browser = await client.RegisterDeviceAsync("Chrome", DevicePlatform.Browser);
    var phone = await client.RegisterDeviceAsync();

    var browserToken = await client.PutAsJsonAsync($"/api/devices/{browser.Id}/push-token",
      new PushTokenRequest("token"), TestData.Json);
    var blankToken = await client.PutAsJsonAsync($"/api/devices/{phone.Id}/push-token", new PushTokenRequest("   "),
      TestData.Json);

    Assert.Equal(HttpStatusCode.BadRequest, browserToken.StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, blankToken.StatusCode);
    Assert.All((await client.GetFromJsonAsync<List<DeviceDto>>("/api/devices", TestData.Json))!,
      d => Assert.False(d.CanReceiveLinks));
  }
}
