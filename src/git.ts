import simpleGit from 'simple-git'

export async function getBranch(folder: string): Promise<string | null> {
  try {
    const git = simpleGit(folder)
    const isRepo = await git.checkIsRepo()
    if (!isRepo) return null
    const status = await git.status()
    return status.current ?? null
  } catch {
    return null
  }
}
