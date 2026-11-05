import type { GitHubRepository } from './githubAuth'

export function filterGitHubRepositories(repositories: GitHubRepository[], query: string): GitHubRepository[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean)
  if (words.length === 0) return repositories
  return repositories.filter((repository) => {
    const name = repository.full_name.toLocaleLowerCase()
    return words.every((word) => name.includes(word))
  })
}
