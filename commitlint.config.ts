import type { UserConfig } from '@commitlint/types'

/**
 * systemfsoftware shared commitlint config.
 *
 * Design rule: a rule is `error` (2) ONLY if a wrong value has real downstream
 * impact in THIS org. Releases run on changesets (.changeset/*.md), NOT commit
 * messages, so scope / punctuation / type-vs-diff have ZERO release impact and
 * must never fail a commit. The one message policy that matters is the
 * AI-coauthor ban.
 */

const configuration: UserConfig = {
  extends: ['@commitlint/config-conventional'],

  plugins: [
    {
      rules: {
        'no-ai-coauthors': ({ raw }) => {
          if (raw == null || raw === '') {
            return [true, 'OK']
          }

          // AI co-author email patterns
          const aiEmailPatterns = [
            /noreply@anthropic\.com/i,
            /cursoragent@cursor\.com/i,
            /noreply@aider\.dev/i,
            /cascade@windsurf\.com/i,
            /noreply@codeium\.com/i,
            /clio-agent@sisyphuslabs\.ai/i,
            /factory-droid\[bot\]@users\.noreply\.github\.com/i,
          ] as const

          // Only scan Co-authored-by lines for AI model mentions to avoid false positives
          // (e.g., "Opus" audio codec, "Haiku" build tool)
          const coauthorLines = raw.match(/^Co-?-?[Aa]uthored-by:.*$/gmi) || []
          const aiModelPatterns = [
            /\b(Claude\s+)?(Opus|Sonnet|Haiku)\b/i,
            /\bgpt-4o\b/i,
            /\bClaude\b.*\b3\.\d+\b/i,
          ] as const
          const hasAIModelInCoauthor = coauthorLines.some((line: string) =>
            aiModelPatterns.some((pattern) => pattern.test(line))
          )

          const hasAIEmail = aiEmailPatterns.some((pattern) => pattern.test(raw))
          const hasAICoauthor = hasAIEmail || hasAIModelInCoauthor

          const message = 'AI co-authors and AI model references are not allowed in commit messages'
          if (hasAICoauthor) return [false, message]
          return [true, 'OK']
        },
      },
    },
  ],

  rules: {
    // The one policy that matters.
    'no-ai-coauthors': [2, 'always'],

    // Type: tidy log/PR grouping only (releases run on changesets).
    'type-empty': [2, 'never'],
    'type-case': [2, 'always', 'lower-case'],
    'type-enum': [
      2,
      'always',
      [
        'ai',
        'api',
        'build',
        'chore',
        'ci',
        'deps',
        'docs',
        'feat',
        'fix',
        'improvement',
        'perf',
        'refactor',
        'revert',
        'security',
        'style',
        'test',
      ],
    ],

    // Subject: must exist; everything else about it is cosmetic.
    'subject-empty': [2, 'never'],
    'subject-case': [0],
    'subject-full-stop': [0],

    // Punctuation: zero impact. OFF. (This is the reported pain.)
    'header-full-stop': [0],
    'body-full-stop': [0],

    // Scope: zero release impact and agents can't guess it. OFF; nudge casing.
    'scope-enum': [0],
    'scope-case': [1, 'always', 'kebab-case'],

    // Length: burns retry tokens, no impact. OFF.
    'header-max-length': [0],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],

    // Readability nudges — warn, never block.
    'body-leading-blank': [1, 'always'],
    'footer-leading-blank': [1, 'always'],
    'references-empty': [1, 'never'],
    // DELETED: 'type-matches-diff-shape' — heuristic that hard-failed agents
    // and its plugin for no downstream benefit. Do not reintroduce.
  },

  defaultIgnores: true,
  ignores: [(commit) => commit.startsWith("Squashed '") || commit.includes('git-subtree-dir:')],
  formatter: '@commitlint/format',
}

export default configuration
