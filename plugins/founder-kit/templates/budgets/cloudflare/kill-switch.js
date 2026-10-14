// Kill switch for {{PROJECT}}: wrap your Worker's fetch handler. When the KV key KILL is "on", every request gets 503
// and no paid downstream work runs. Bind a KV namespace as FK_FLAGS in wrangler config:
//   [[kv_namespaces]]
//   binding = "FK_FLAGS"
//   id = "<namespace id from: npx wrangler kv namespace create FK_FLAGS>"
// Stop:   npx wrangler kv key put --binding=FK_FLAGS KILL on --remote
// Resume: npx wrangler kv key delete --binding=FK_FLAGS KILL --remote

export function withKillSwitch(handler) {
  return {
    ...handler,
    async fetch(request, env, ctx) {
      if ((await env.FK_FLAGS?.get('KILL', { cacheTtl: 60 })) === 'on') {
        return new Response('Temporarily unavailable', { status: 503, headers: { 'retry-after': '3600' } });
      }
      return handler.fetch(request, env, ctx);
    },
  };
}

// Usage in your Worker entry:
//   import { withKillSwitch } from './kill-switch.js';
//   export default withKillSwitch({ async fetch(request, env, ctx) { /* your app */ } });
