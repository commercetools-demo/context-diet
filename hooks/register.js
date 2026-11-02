import { describeCommand, describeTool, guardCall, maybeAsk, offerAgent, PANE, renderBand, renderPane, runDiet } from './lib/core.jsx'

export const register = on => {
  // The command, and the once-per-session ask. A mod reload fires session.start
  // again; the asked:<session id> key in maybeAsk stops a second ask.
  // (classic.SessionStart is not hooked: the built-in security plugin skips it.)
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'diet',
      description: 'Review and trim loaded context; set model and effort',
      argumentHint: '[off|on <targets> | model <name> | effort <level> | status]',
      immediate: true,
    })
    await maybeAsk($, undefined)
    return next(e)
  })

  on('tool.describe', ($, e, next) => describeTool($, e, next))
  on('tool.call', ($, e, next) => guardCall($, e, next))
  on('agent.offer', ($, e, next) => offerAgent($, e, next))
  on('command.describe', ($, e, next) => describeCommand($, e, next))
  on('command.run', { command: 'diet' }, ($, e) => runDiet($, e))
  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => renderPane($, e))
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => renderBand($, e, next))
}
