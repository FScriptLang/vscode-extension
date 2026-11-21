using System.Reflection;

var (directory, productVersion, sdkVersion) = (args[0], args[1], args[2]);
var expectedProductVersion = Version.Parse(productVersion + ".0");
foreach (var name in new[] { "FScript.Language", "FScript.Runtime", "FScript.CSharpInterop", "FScript.LanguageServer" })
{
    var assembly = AssemblyName.GetAssemblyName(Path.Combine(directory, name + ".dll"));
    if (assembly.Version != expectedProductVersion)
        throw new InvalidOperationException($"{name} has assembly version {assembly.Version}, expected {expectedProductVersion}.");
}

var sdk = AssemblyName.GetAssemblyName(Path.Combine(directory, "FScript.Extensibility.dll"));
if (sdk.Version != Version.Parse(sdkVersion) || sdk.GetPublicKeyToken() is not { Length: 0 })
    throw new InvalidOperationException($"Expected unsigned FScript.Extensibility {sdkVersion}, found {sdk.FullName}.");
