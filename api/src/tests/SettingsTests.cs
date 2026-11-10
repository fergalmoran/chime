using System.Net;
using Chime.Api.Contracts;
using Chime.Api.Data;

namespace Chime.Api.Tests;

public class SettingsTests(ApiFactory factory) : IClassFixture<ApiFactory> {
  [Fact]
  public async Task New_accounts_get_sync_on_with_every_category_and_a_week_of_retention() {
    var (client, _) = await factory.CreateAuthenticatedClientAsync();

    var settings = await client.GetSettingsAsync();

    Assert.True(settings.SyncEnabled);
    Assert.True(settings.IncludeMessageBody);
    Assert.Equal(7, settings.RetentionDays);
    Assert.Empty(settings.MutedApps);
    // "Other" (system and app chatter) is opt-in.
    Assert.Equal(Enum.GetValues<NotificationCategory>().Except([NotificationCategory.Other]).Order(),
      settings.EnabledCategories.Order());
  }

  [Fact]
  public async Task Saved_settings_are_normalised_and_persist() {
    var (client, _) = await factory.CreateAuthenticatedClientAsync();
    var settings = await client.GetSettingsAsync();

    var saved = await client.PutSettingsAsync(settings with {
      RetentionDays = 30,
      MutedApps = ["  com.whatsapp ", "com.whatsapp", "", "   ", "com.slack"],
      EnabledCategories = [NotificationCategory.Sms, NotificationCategory.Sms, NotificationCategory.Call]
    });

    Assert.Equal(["com.whatsapp", "com.slack"], saved.MutedApps);
    Assert.Equal([NotificationCategory.Sms, NotificationCategory.Call], saved.EnabledCategories);
    var reloaded = await client.GetSettingsAsync();
    Assert.Equal(30, reloaded.RetentionDays);
    Assert.Equal(saved.MutedApps, reloaded.MutedApps);
    Assert.Equal(saved.EnabledCategories, reloaded.EnabledCategories);
  }

  [Theory]
  [InlineData(0)]
  [InlineData(-1)]
  [InlineData(366)]
  public async Task Retention_outside_one_to_365_days_is_rejected(int days) {
    var (client, _) = await factory.CreateAuthenticatedClientAsync();
    var settings = await client.GetSettingsAsync();

    var response = await client.PutAsJsonAsync("/api/settings", settings with {RetentionDays = days}, TestData.Json);

    Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    Assert.Equal(7, (await client.GetSettingsAsync()).RetentionDays);
  }

  [Fact]
  public async Task Settings_belong_to_each_user() {
    var (alice, _) = await factory.CreateAuthenticatedClientAsync();
    var (bob, _) = await factory.CreateAuthenticatedClientAsync();

    await alice.PutSettingsAsync(await alice.GetSettingsAsync() with {SyncEnabled = false, RetentionDays = 1});

    var bobs = await bob.GetSettingsAsync();
    Assert.True(bobs.SyncEnabled);
    Assert.Equal(7, bobs.RetentionDays);
  }

  [Fact]
  public async Task Pausing_sync_drops_new_notifications_until_it_is_resumed() {
    var (client, _) = await factory.CreateAuthenticatedClientAsync();
    var settings = await client.GetSettingsAsync();

    await client.PutSettingsAsync(settings with {SyncEnabled = false});
    var paused = await client.PostAsJsonAsync("/api/notifications", TestData.Notification(), TestData.Json);
    Assert.Equal(HttpStatusCode.NoContent, paused.StatusCode);
    Assert.Empty((await client.GetNotificationsAsync()).Items);

    await client.PutSettingsAsync(settings with {SyncEnabled = true});
    await client.PostNotificationAsync(TestData.Notification());
    Assert.Single((await client.GetNotificationsAsync()).Items);
  }

  [Fact]
  public async Task Turning_off_message_text_stores_the_title_but_not_the_body() {
    var (client, _) = await factory.CreateAuthenticatedClientAsync();
    await client.PutSettingsAsync(await client.GetSettingsAsync() with {IncludeMessageBody = false});

    var created = await client.PostNotificationAsync(TestData.Notification());

    Assert.Equal("Alice", created.Title);
    Assert.Null(created.Body);
    Assert.Null(Assert.Single((await client.GetNotificationsAsync()).Items).Body);
  }

  [Fact]
  public async Task Me_returns_the_signed_in_account() {
    var email = $"me-{Guid.NewGuid():N}@example.com";
    var (client, _) = await factory.CreateAuthenticatedClientAsync(email);

    var me = await client.GetFromJsonAsync<MeResponse>("/api/me", TestData.Json);

    Assert.Equal(email, me!.Email);
    Assert.False(string.IsNullOrEmpty(me.Id));
  }
}
