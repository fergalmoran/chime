using System.Net;
using Chime.Api.Data;
using Chime.Api.Contracts;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Chime.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Chime.Api.Tests;

/// <summary>An API whose clock only moves when a test moves it.</summary>
public sealed class ManualClockApiFactory : ApiFactory {
  public ManualClock Clock { get; } = new(new DateTimeOffset(2026, 11, 1, 12, 0, 0, TimeSpan.Zero));

  protected override void ConfigureWebHost(IWebHostBuilder builder) {
    base.ConfigureWebHost(builder);
    builder.ConfigureTestServices(services => services.AddSingleton<TimeProvider>(Clock));
  }
}

public sealed class ManualClock(DateTimeOffset start) : TimeProvider {
  private DateTimeOffset _now = start;

  public override DateTimeOffset GetUtcNow() {
    return _now;
  }

  public void Advance(TimeSpan by) {
    _now += by;
  }
}

public class NotificationQueryTests(ManualClockApiFactory factory) : IClassFixture<ManualClockApiFactory> {
  [Fact]
  public async Task Feed_is_newest_first_and_pages_through_everything_exactly_once() {
    var (client, _) = await factory.CreateAuthenticatedClientAsync();
    var sent = new List<Guid>();
    for (var i = 0; i < 7; i++) {
      factory.Clock.Advance(TimeSpan.FromSeconds(1));
      sent.Add((await client.PostNotificationAsync(TestData.Notification())).Id);
    }

    var seen = new List<Guid>();
    var pages = 0;
    var query = "?limit=3";
    while (true) {
      var page = await client.GetNotificationsAsync(query);
      pages++;
      Assert.True(page.Items.Count <= 3);
      seen.AddRange(page.Items.Select(n => n.Id));
      if (page.NextBefore is not { } next) break;

      query = $"?limit=3&before={Uri.EscapeDataString(next.ToString("O"))}";
    }

    Assert.Equal(3, pages);
    Assert.Equal(Enumerable.Reverse(sent), seen);
  }

  [Fact]
  public async Task Notifications_received_at_the_same_instant_are_not_skipped_between_pages() {
    var (client, _) = await factory.CreateAuthenticatedClientAsync();
    factory.Clock.Advance(TimeSpan.FromMinutes(1));
    var older = (await client.PostNotificationAsync(TestData.Notification())).Id;
    factory.Clock.Advance(TimeSpan.FromMinutes(1));
    var sameInstant = new HashSet<Guid>();
    for (var i = 0; i < 4; i++) sameInstant.Add((await client.PostNotificationAsync(TestData.Notification())).Id);

    var first = await client.GetNotificationsAsync("?limit=2");
    var second = await client.GetNotificationsAsync(
      $"?limit=2&before={Uri.EscapeDataString(first.NextBefore!.Value.ToString("O"))}");

    // The page grows past the limit rather than splitting the instant (`before` is exclusive).
    Assert.Equal(sameInstant, first.Items.Select(n => n.Id).ToHashSet());
    Assert.Equal(older, Assert.Single(second.Items).Id);
    Assert.Null(second.NextBefore);
  }

  [Theory]
  [InlineData("?limit=0", 1)]
  [InlineData("?limit=-5", 1)]
  [InlineData("?limit=2", 2)]
  [InlineData("?limit=100000", 3)]
  [InlineData("", 3)]
  public async Task Page_size_is_clamped(string query, int expected) {
    var (client, _) = await factory.CreateAuthenticatedClientAsync();
    for (var i = 0; i < 3; i++) {
      factory.Clock.Advance(TimeSpan.FromSeconds(1));
      await client.PostNotificationAsync(TestData.Notification());
    }

    var page = await client.GetNotificationsAsync(query);

    Assert.Equal(expected, page.Items.Count);
    Assert.Equal(expected < 3, page.NextBefore is not null);
  }

  [Fact]
  public async Task Dismissed_notifications_are_hidden_unless_asked_for() {
    var (client, _) = await factory.CreateAuthenticatedClientAsync();
    factory.Clock.Advance(TimeSpan.FromSeconds(1));
    var dismissed = await client.PostNotificationAsync(TestData.Notification());
    factory.Clock.Advance(TimeSpan.FromSeconds(1));
    var open = await client.PostNotificationAsync(TestData.Notification());
    (await client.PostAsync($"/api/notifications/{dismissed.Id}/dismiss", null)).EnsureSuccessStatusCode();

    var visible = await client.GetNotificationsAsync();
    var all = await client.GetNotificationsAsync("?includeDismissed=true");

    Assert.Equal(open.Id, Assert.Single(visible.Items).Id);
    Assert.Equal([open.Id, dismissed.Id], all.Items.Select(n => n.Id));
    Assert.NotNull(all.Items[1].DismissedAt);
  }

  [Fact]
  public async Task Dismissing_twice_or_someone_elses_notification_is_not_found() {
    var (alice, _) = await factory.CreateAuthenticatedClientAsync();
    var (bob, _) = await factory.CreateAuthenticatedClientAsync();
    var notification = await alice.PostNotificationAsync(TestData.Notification());

    Assert.Equal(HttpStatusCode.NotFound,
      (await bob.PostAsync($"/api/notifications/{notification.Id}/dismiss", null)).StatusCode);
    Assert.Equal(HttpStatusCode.NoContent,
      (await alice.PostAsync($"/api/notifications/{notification.Id}/dismiss", null)).StatusCode);
    Assert.Equal(HttpStatusCode.NotFound,
      (await alice.PostAsync($"/api/notifications/{notification.Id}/dismiss", null)).StatusCode);
  }

  [Fact]
  public async Task Users_can_delete_only_their_own_notifications() {
    var (alice, _) = await factory.CreateAuthenticatedClientAsync();
    var (bob, _) = await factory.CreateAuthenticatedClientAsync();
    var notification = await alice.PostNotificationAsync(TestData.Notification());

    Assert.Equal(HttpStatusCode.NotFound, (await bob.DeleteAsync($"/api/notifications/{notification.Id}")).StatusCode);
    Assert.Single((await alice.GetNotificationsAsync()).Items);

    Assert.Equal(HttpStatusCode.NoContent,
      (await alice.DeleteAsync($"/api/notifications/{notification.Id}")).StatusCode);
    Assert.Empty((await alice.GetNotificationsAsync("?includeDismissed=true")).Items);
    Assert.Equal(HttpStatusCode.NotFound,
      (await alice.DeleteAsync($"/api/notifications/{notification.Id}")).StatusCode);
  }

  [Fact]
  public async Task Posted_time_defaults_to_receipt_time_and_is_kept_when_given() {
    var (client, _) = await factory.CreateAuthenticatedClientAsync();
    var postedAt = factory.Clock.GetUtcNow().AddMinutes(-5);

    var withTime = await client.PostNotificationAsync(TestData.Notification() with {PostedAt = postedAt});
    var withoutTime = await client.PostNotificationAsync(TestData.Notification() with {PostedAt = null});

    Assert.Equal(postedAt, withTime.PostedAt);
    Assert.Equal(factory.Clock.GetUtcNow(), withTime.ReceivedAt);
    Assert.Equal(withoutTime.ReceivedAt, withoutTime.PostedAt);
  }

  [Fact]
  public async Task The_same_external_key_is_independent_per_user() {
    var (alice, _) = await factory.CreateAuthenticatedClientAsync();
    var (bob, _) = await factory.CreateAuthenticatedClientAsync();

    await alice.PostNotificationAsync(TestData.Notification(externalKey: "shared-key"));
    await bob.PostNotificationAsync(TestData.Notification(externalKey: "shared-key"));

    Assert.Single((await alice.GetNotificationsAsync()).Items);
    Assert.Single((await bob.GetNotificationsAsync()).Items);
  }

  [Fact]
  public async Task Retention_uses_each_users_own_window_and_seven_days_by_default() {
    var (shortRetention, _) = await factory.CreateAuthenticatedClientAsync();
    var (defaultRetention, _) = await factory.CreateAuthenticatedClientAsync();
    await shortRetention.PutSettingsAsync(await shortRetention.GetSettingsAsync() with {RetentionDays = 1});
    await shortRetention.PostNotificationAsync(TestData.Notification());
    await defaultRetention.PostNotificationAsync(TestData.Notification());
    var shortId = (await shortRetention.GetFromJsonAsync<MeResponse>("/api/me", TestData.Json))!.Id;
    var defaultId = (await defaultRetention.GetFromJsonAsync<MeResponse>("/api/me", TestData.Json))!.Id;
    var retention = ActivatorUtilities.CreateInstance<RetentionService>(factory.Services);

    // Moving the clock days ahead also expires the clients' bearer tokens, so check the database directly.
    factory.Clock.Advance(TimeSpan.FromDays(2));
    await retention.PurgeAsync();
    Assert.Equal(0, await CountNotificationsAsync(shortId));
    Assert.Equal(1, await CountNotificationsAsync(defaultId));

    factory.Clock.Advance(TimeSpan.FromDays(6));
    await retention.PurgeAsync();
    Assert.Equal(0, await CountNotificationsAsync(defaultId));
  }

  private async Task<int> CountNotificationsAsync(string userId) {
    using var scope = factory.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    return await db.Notifications.CountAsync(n => n.UserId == userId);
  }
}
