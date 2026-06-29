import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

export async function GET() {
  try {
    // agent/index.js lives one level above the Next.js project root
    const filePath = join(process.cwd(), '..', 'agent', 'index.js')
    const content = readFileSync(filePath, 'utf-8')
    return new NextResponse(content, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  } catch {
    return NextResponse.json({ error: 'Skill file not found' }, { status: 404 })
  }
}
