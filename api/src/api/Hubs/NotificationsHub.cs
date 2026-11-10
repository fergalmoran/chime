using Chime.Api.Contracts;
using Chime.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Chime.Api.Hubs;

public interface INotificationsClient {
  Task NotificationReceived(NotificationDto notification);

  Task NotificationDismissed(Guid id);
}

/// <summary>Real-time channel for desktop clients (web app, browser extension).</summary>
[Authorize]
public class NotificationsHub(AppDbContext db) : Hub<INotificationsClient> {
  public override async Task OnConnectedAsync() {
    // A still-unexpired token from a deleted account must not open a connection.
    var userId = Context.UserIdentifier;
    if (userId is null || !await db.Users.AnyAsync(u => u.Id == userId, Context.ConnectionAborted)) {
      Context.Abort();
      return;
    }

    await base.OnConnectedAsync();
  }
}
