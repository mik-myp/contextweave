-- Isolated feasibility fixture, NOT a production migration or a hosted service.
-- Login passwords/roles are created by the harness through stdin, never stored here.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE ROLE cw_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE SCHEMA cw AUTHORIZATION cw_owner;
SET ROLE cw_owner;
CREATE TABLE cw.environments (
  workspace_id text NOT NULL, environment_id text NOT NULL, name text NOT NULL,
  revision bigint NOT NULL DEFAULT 1, PRIMARY KEY(workspace_id,environment_id)
);
CREATE TABLE cw.memberships (
  workspace_id text NOT NULL, environment_id text NOT NULL, principal name NOT NULL,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY(workspace_id,environment_id,principal),
  FOREIGN KEY(workspace_id,environment_id) REFERENCES cw.environments
);
INSERT INTO cw.environments VALUES ('workspace-a','same-id','Alice data',1),('workspace-b','same-id','Bob data',1);
INSERT INTO cw.memberships VALUES ('workspace-a','same-id','cw_alice',true),('workspace-b','same-id','cw_bob',true);
CREATE FUNCTION cw.can_access(w text,e text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM cw.memberships WHERE workspace_id=w AND environment_id=e
    AND principal=SESSION_USER AND active)
$$;
REVOKE ALL ON FUNCTION cw.can_access(text,text) FROM PUBLIC;
ALTER TABLE cw.environments ENABLE ROW LEVEL SECURITY;
ALTER TABLE cw.environments FORCE ROW LEVEL SECURITY;
CREATE POLICY environment_members ON cw.environments USING(cw.can_access(workspace_id,environment_id))
  WITH CHECK(cw.can_access(workspace_id,environment_id));
CREATE FUNCTION cw.rename_environment(w text,e text,n text,expected bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE changed bigint;
BEGIN
  UPDATE cw.environments SET name=n,revision=revision+1
    WHERE workspace_id=w AND environment_id=e AND revision=expected
    RETURNING revision INTO changed;
  IF changed IS NULL THEN RAISE EXCEPTION 'CW_DENIED_OR_STALE'; END IF;
  RETURN changed;
END
$$;
REVOKE ALL ON FUNCTION cw.rename_environment(text,text,text,bigint) FROM PUBLIC;
GRANT USAGE ON SCHEMA cw TO cw_alice,cw_bob;
GRANT SELECT ON cw.environments TO cw_alice,cw_bob;
GRANT EXECUTE ON FUNCTION cw.can_access(text,text),cw.rename_environment(text,text,text,bigint) TO cw_alice,cw_bob;
-- Deliberately naive TTL-only lease, to demonstrate why fencing is NOT proof
-- that an old browser stopped. This function must never enter the application.
CREATE TABLE cw.leases (
  workspace_id text NOT NULL, environment_id text NOT NULL, principal name NOT NULL,
  generation bigint NOT NULL, expires_at timestamptz NOT NULL,
  PRIMARY KEY(workspace_id,environment_id),
  FOREIGN KEY(workspace_id,environment_id) REFERENCES cw.environments
);
CREATE FUNCTION cw.unsafe_ttl_claim(w text,e text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE generation bigint;
BEGIN
  IF NOT cw.can_access(w,e) THEN RAISE EXCEPTION 'CW_DENIED'; END IF;
  INSERT INTO cw.leases AS existing VALUES(w,e,SESSION_USER,1,clock_timestamp()+interval '1 second')
    ON CONFLICT(workspace_id,environment_id) DO UPDATE
    SET principal=SESSION_USER,generation=existing.generation+1,expires_at=clock_timestamp()+interval '1 second'
    WHERE existing.expires_at<clock_timestamp()
    RETURNING existing.generation INTO generation;
  IF generation IS NULL THEN RAISE EXCEPTION 'CW_BUSY'; END IF;
  RETURN generation;
END
$$;
CREATE FUNCTION cw.commit_if_fenced(w text,e text,g bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NOT cw.can_access(w,e) OR NOT EXISTS(SELECT 1 FROM cw.leases
    WHERE workspace_id=w AND environment_id=e AND principal=SESSION_USER AND generation=g
      AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'CW_DENIED_OR_STALE'; END IF;
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION cw.unsafe_ttl_claim(text,text),cw.commit_if_fenced(text,text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cw.unsafe_ttl_claim(text,text),cw.commit_if_fenced(text,text,bigint) TO cw_alice,cw_bob;
RESET ROLE;
