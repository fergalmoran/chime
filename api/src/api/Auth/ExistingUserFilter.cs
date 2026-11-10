using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Chime.Api.Data;

namespace Chime.Api.Auth;

public static class ExistingUserFilter
{
    /// <summary>
    /// Bearer access tokens are self-contained and stay valid until they expire, even after the account is deleted.
    /// This rejects them with 401 once the user no longer exists, so clients fall back to /refresh, which fails
    /// for a deleted user, and sign out.
    /// </summary>
    public static RouteGroupBuilder RequireExistingUser(this RouteGroupBuilder group)
    {
        group.AddEndpointFilter(async (context, next) =>
        {
            var userId = context.HttpContext.User.FindFirstValue(ClaimTypes.NameIdentifier);
            var db = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
            if (userId is null || !await db.Users.AnyAsync(u => u.Id == userId, context.HttpContext.RequestAborted))
            {
                return TypedResults.Unauthorized();
            }
            return await next(context);
        });
        return group;
    }
}
