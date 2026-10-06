import { mkdir, readFile, writeFile, rename, stat } from "node:fs/promises"
import path from "node:path"
import type { BookmapEvidence } from "./BookmapEvidence.mts"

/** Frozen assessments survive restart, independently of current source epochs. */
export class BookmapEntryArchive {
  private readonly evidence: BookmapEvidence
  private readonly file: string
  private key = ""
  private queue: Promise<void> = Promise.resolve()
  private usable = true
  constructor(directory: string, evidence: BookmapEvidence) { this.evidence=evidence; this.file=path.join(directory,"bookmap-entry-evidence.json") }
  async load(): Promise<void> {
    try {
      if((await stat(this.file)).size>8*1024*1024) throw new Error("Entry evidence archive is oversized")
      const data=JSON.parse(await readFile(this.file,"utf8"))
      if(data.version!==1) throw new Error("Unsupported entry evidence archive")
      this.evidence.restoreEntries(data.entries)
      const entries=this.evidence.snapshot().entries; this.key=`${entries.length}:${entries.at(-1)?.id}`
    } catch(error) { if((error as NodeJS.ErrnoException).code!=="ENOENT") {this.usable=false;this.evidence.archiveError="Entry evidence archive could not be loaded; existing file preserved"} }
  }
  capture(): void {
    if(!this.usable) return
    const entries=this.evidence.snapshot().entries, key=`${entries.length}:${entries.at(-1)?.id}`
    if(!entries.length || key===this.key) return
    this.key=key
    const content=JSON.stringify({version:1,entries})
    this.queue=this.queue.then(async()=>{await mkdir(path.dirname(this.file),{recursive:true});await writeFile(`${this.file}.tmp`,content,"utf8");await rename(`${this.file}.tmp`,this.file);this.evidence.archiveError=null}).catch(()=>{this.key="";this.evidence.archiveError="Frozen entry evidence could not be saved"})
  }
  async flush(): Promise<void> { await this.queue }
}
