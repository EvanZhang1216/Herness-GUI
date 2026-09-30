"""Herness desktop conversations follow their account/profile's shared model settings."""


def sync_runtime(sid, session):
    """Called inside the turn/profile scope, before inference; never alter a streaming agent."""
    from tui_gateway import server
    agent = session.get('agent')
    if agent is None:
        return
    model, runtime = server._resolve_agent_model_runtime(None, None)
    target = {'model': model, **{key: runtime.get(key) or ''
                                for key in ('provider', 'api_key', 'base_url', 'api_mode')}}
    # Provider aliases and inferred API modes can differ from agent's canonical
    # fields. Remember the resolved input to avoid rebuilding transport each turn.
    if session.get('_desktop_resolved_model') == target:
        return
    # Resolve credentials and endpoints too: equal model names do not imply equal connections.
    if any((getattr(agent, key, None) or '') != value for key, value in target.items()):
        prompt = getattr(agent, '_cached_system_prompt', None)
        agent.switch_model(new_model=model, new_provider=target['provider'],
                           api_key=target['api_key'], base_url=target['base_url'],
                           api_mode=target['api_mode'], capabilities=runtime.get('capabilities'))
        # Model routing changes must not reload memories or rewrite the conversation's prefix.
        if prompt is not None:
            agent._cached_system_prompt = prompt
        server._restart_slash_worker(sid, session)
        server._persist_live_session_runtime(session)
        server._emit_session_info(sid, session)
    session['_desktop_resolved_model'] = target
    session.pop('model_override', None)
    session.pop('resume_runtime_overrides', None)
