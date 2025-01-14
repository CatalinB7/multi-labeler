import * as core from '@actions/core'
import * as github from '@actions/github'

import {
  checks,
  StatusCheck
} from './checks'
import {
  Config,
  getConfig
} from './config'
import {
  labels,
  mergeLabels
} from './labeler'

const githubToken = core.getInput('github-token')
const configPath = core.getInput('config-path', {required: true})
const configRepo = core.getInput('config-repo')

const client = github.getOctokit(githubToken)
const payload =
  github.context.payload.pull_request || github.context.payload.issue

if (!payload?.number) {
  throw new Error(
    'Could not get issue_number from pull_request or issue from context'
  )
}

async function addLabels(labels: string[]): Promise<void> {
  core.setOutput('addLabels labels =', labels)

  if (!labels.length) {
    return
  }

  await new Promise(resolve => setTimeout(resolve, 15000))
  console.log('adding labels =', labels);

  await client.issues.addLabels({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issue_number: payload!.number,
    labels
  })
}

async function removeLabels(
  labels: string[],
  config: Config
): Promise<unknown[]> {
  const eventName = github.context.eventName
  if (!['pull_request', 'pull_request_target', 'issue'].includes(eventName)) {
    return []
  }
  console.log('removeLabels config =', config, '\nlabels=', labels);
  return Promise.all(
    (config.labels || [])
      .filter(label => {
        // Is sync, not matched in final set of labels
        return label.sync && !labels.includes(label.label)
      })
      .map(label => {
        return setTimeout(() => {
          console.log('removing label =', label.label);
          client.issues
            .removeLabel({
              owner: github.context.repo.owner,
              repo: github.context.repo.repo,
              issue_number: payload!.number,
              name: label.label
            })
            .catch(ignored => {
              return undefined
            })
        }, 15000)
      })
  )
}

async function addChecks(checks: StatusCheck[]): Promise<void> {
  if (!checks.length) {
    return
  }

  if (!github.context.payload.pull_request) {
    return
  }

  const sha = github.context.payload.pull_request?.head.sha as string
  await Promise.all([
    checks.map(check => {
      client.repos.createCommitStatus({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        sha,
        context: check.context,
        state: check.state,
        description: check.description,
        target_url: check.url
      })
    })
  ])
}

getConfig(client, configPath, configRepo)
  .then(async config => {
    const labeled = await labels(client, config)
    const finalLabels = mergeLabels(labeled, config)
    console.log('config =', config, '\nlabeled = ', labeled, '\nfinalLabels =', finalLabels);
    return Promise.all([
      addLabels(finalLabels),
      removeLabels(finalLabels, config),
      checks(client, config, finalLabels).then(checks => addChecks(checks))
    ])
  })
  .catch(error => {
    core.error(error)
    core.setFailed(error.message)
  })
