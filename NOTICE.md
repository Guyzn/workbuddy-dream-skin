# Notice

## Not affiliated
WorkBuddy Dream Skin is an **unofficial, external theme tool**. It does **not**
modify the WorkBuddy application bundle, its `app.asar`, or its code signature.
It themes the running app through a local loopback Chrome DevTools Protocol
(CDP) injection, exactly like browser devtools would.

WorkBuddy and related marks are the property of their respective owners. This
project is not endorsed by, affiliated with, or sponsored by the WorkBuddy
developer.

## Trademark & likeness
- Codex, ChatGPT, and OpenAI are trademarks of their respective owners and are
  not referenced or targeted by this tool.
- The bundled preset artwork is **procedurally generated** (gradients + soft
  glows) and contains no third-party trademarks, likenesses, or copyrighted
  imagery.
- If you import your own background images via the Customize flow, you are
  responsible for confirming you have the rights to use and redistribute that
  material.

## Runtime
The injector runs on the Node.js runtime that ships with WorkBuddy (or any
Node.js >= 20). It does not alter WorkBuddy's own runtime or API configuration.

## Safety boundary
- CDP is bound to `127.0.0.1` only. Do not run untrusted local programs while the
  debug port is open.
- The skin is **non-persistent**: restarting WorkBuddy without the debug flag
  returns it to the stock UI. `Restore` does exactly that.
- The tool never reads or rewrites your WorkBuddy settings, API keys, or model
  provider configuration.
