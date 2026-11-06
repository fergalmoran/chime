# Chime API: ASP.NET Core on .NET 10, SQLite on the /data volume.
# Build from the api/ directory:  docker build -t chime-api api

FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
WORKDIR /src

# Restore first so the package layer is cached until a project file changes.
COPY global.json ./
COPY src/Chime.Api/Chime.Api.csproj src/Chime.Api/
RUN dotnet restore src/Chime.Api/Chime.Api.csproj

COPY src/ src/
RUN dotnet publish src/Chime.Api/Chime.Api.csproj -c Release -o /app --no-restore /p:UseAppHost=false

# Alpine so the health check can use busybox wget; SQLite ships a musl build.
FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine AS runtime
WORKDIR /app

# /data holds the SQLite database and the Data Protection key ring (which keeps sign-ins valid
# across restarts). Created here, owned by the non-root user, so a fresh named volume inherits it.
RUN mkdir -p /data/keys && chown -R "$APP_UID" /data
VOLUME /data

ENV ASPNETCORE_HTTP_PORTS=8080 \
    ASPNETCORE_FORWARDEDHEADERS_ENABLED=true \
    ConnectionStrings__Default="Data Source=/data/chime.db" \
    DataProtection__KeysPath=/data/keys \
    Database__MigrateOnStartup=true \
    Logging__LogLevel__Microsoft.EntityFrameworkCore.Database.Command=Warning

COPY --from=build /app .

USER $APP_UID
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/api/health || exit 1

ENTRYPOINT ["dotnet", "Chime.Api.dll"]
