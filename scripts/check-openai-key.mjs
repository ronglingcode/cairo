import { readReferencedSecrets } from "../src/engine/ReferencedSecrets.mts"
try {
  const secrets = await readReferencedSecrets(process.argv[2])
  console.log(secrets.openai?.apiKey ? "available" : "missing")
} catch {
  console.error("Cannot read secretsFile; check its path and provisioning format.")
  process.exitCode = 1
}
