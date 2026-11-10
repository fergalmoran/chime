using Microsoft.EntityFrameworkCore;
using Chime.Api.Data;

namespace Chime.Api.Services;

/// <summary>Periodically deletes notifications older than each user's retention window.</summary>
public class RetentionService(IServiceScopeFactory scopeFactory, TimeProvider clock, ILogger<RetentionService> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromHours(1);
    private const int DefaultRetentionDays = 7;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval, clock);
        do
        {
            try
            {
                await PurgeAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Notification retention purge failed");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    public async Task<int> PurgeAsync(CancellationToken ct = default)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var now = clock.GetUtcNow();
        var total = 0;

        var retentionByUser = await db.UserSettings.ToDictionaryAsync(s => s.UserId, s => s.RetentionDays, ct);
        var userIds = await db.Notifications.Select(n => n.UserId).Distinct().ToListAsync(ct);

        foreach (var userId in userIds)
        {
            var days = retentionByUser.GetValueOrDefault(userId, DefaultRetentionDays);
            var cutoff = now.AddDays(-days);
            total += await db.Notifications.Where(n => n.UserId == userId && n.ReceivedAt < cutoff).ExecuteDeleteAsync(ct);
        }

        if (total > 0) logger.LogInformation("Purged {Count} expired notifications", total);
        return total;
    }
}
