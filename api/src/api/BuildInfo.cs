using System.Reflection;

namespace Chime.Api;

public static class BuildInfo {
  // Set at build time with -p:Version=<semver> (the Dockerfile's VERSION build arg, from the api-v* release tag).
  public static readonly string Version =
    typeof(BuildInfo).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
    ?? typeof(BuildInfo).Assembly.GetName().Version?.ToString()
    ?? "unknown";
}
