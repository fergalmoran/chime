using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using Microsoft.EntityFrameworkCore;

namespace Chime.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : IdentityDbContext<AppUser>(options)
{
    public DbSet<Device> Devices => Set<Device>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<UserSettings> UserSettings => Set<UserSettings>();

    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        // SQLite can't order/compare DateTimeOffset natively; store as sortable binary instead.
        if (Database.IsSqlite())
        {
            configurationBuilder.Properties<DateTimeOffset>().HaveConversion<DateTimeOffsetToBinaryConverter>();
        }
    }

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<Device>(e =>
        {
            e.Property(d => d.Name).HasMaxLength(100);
            e.Property(d => d.Platform).HasConversion<string>().HasMaxLength(20);
            e.Property(d => d.PushToken).HasMaxLength(4096);
            e.Property(d => d.WebPushEndpoint).HasMaxLength(2048);
            e.Property(d => d.WebPushP256dh).HasMaxLength(200);
            e.Property(d => d.WebPushAuth).HasMaxLength(100);
            e.HasOne(d => d.User).WithMany(u => u.Devices).HasForeignKey(d => d.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(d => d.UserId);
        });

        builder.Entity<Notification>(e =>
        {
            e.Property(n => n.AppId).HasMaxLength(200);
            e.Property(n => n.AppName).HasMaxLength(200);
            e.Property(n => n.Title).HasMaxLength(500);
            e.Property(n => n.Body).HasMaxLength(4000);
            e.Property(n => n.ExternalKey).HasMaxLength(200);
            e.Property(n => n.Category).HasConversion<string>().HasMaxLength(20);
            e.HasOne<AppUser>().WithMany().HasForeignKey(n => n.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(n => n.SourceDevice).WithMany().HasForeignKey(n => n.SourceDeviceId).OnDelete(DeleteBehavior.SetNull);
            e.HasIndex(n => new { n.UserId, n.ReceivedAt });
            e.HasIndex(n => new { n.UserId, n.ExternalKey }).IsUnique().HasFilter("ExternalKey IS NOT NULL");
        });

        builder.Entity<UserSettings>(e =>
        {
            e.HasKey(s => s.UserId);
            e.HasOne<AppUser>().WithOne(u => u.Settings).HasForeignKey<UserSettings>(s => s.UserId).OnDelete(DeleteBehavior.Cascade);
            e.PrimitiveCollection(s => s.MutedApps);
            e.PrimitiveCollection(s => s.EnabledCategories);
        });
    }
}
