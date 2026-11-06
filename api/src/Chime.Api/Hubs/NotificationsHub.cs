using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Chime.Api.Contracts;

namespace Chime.Api.Hubs;

public interface INotificationsClient
{
    Task NotificationReceived(NotificationDto notification);
    Task NotificationDismissed(Guid id);
}

/// <summary>Real-time channel for desktop clients (web app, browser extension).</summary>
[Authorize]
public class NotificationsHub : Hub<INotificationsClient>;
