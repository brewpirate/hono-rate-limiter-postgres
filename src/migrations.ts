export const initQuery = `
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

    CREATE SCHEMA IF NOT EXISTS rate_limit;

    CREATE TABLE IF NOT EXISTS rate_limit.sessions (
        id uuid DEFAULT uuid_generate_v1() PRIMARY KEY,
        name_ text UNIQUE,
        type_ text,
        registered_at timestamptz DEFAULT now(),
        expires_at timestamptz
    );

    CREATE OR REPLACE FUNCTION rate_limit.session_select(name_ TEXT, type_ TEXT)
    RETURNS TABLE (id UUID, name_ TEXT, type_ TEXT, expires_at TIMESTAMPTZ) AS
    $bd$
        SELECT id, name_, type_, expires_at
        FROM rate_limit.sessions
        WHERE name_ = $1 AND type_ = $2
        LIMIT 1;
    $bd$
    LANGUAGE sql;

    CREATE OR REPLACE FUNCTION rate_limit.session_reset(
        name_ TEXT, type_ TEXT, expires_at_ TIMESTAMPTZ
    )
    RETURNS TABLE (id UUID, name_ TEXT, type_ TEXT) AS
    $bd$
        DELETE FROM rate_limit.sessions 
        WHERE name_ = $1 AND type_ = $2;

        INSERT INTO rate_limit.sessions(name_, type_, expires_at) 
        SELECT $1, $2, $3 
        RETURNING id, name_, type_;
    $bd$
    LANGUAGE sql;
    `
export const summaryRecordsQuery = `
    CREATE TABLE IF NOT EXISTS rate_limit.records_aggregated (
        key text PRIMARY KEY,
        session_id uuid REFERENCES rate_limit.sessions (id) ON DELETE CASCADE,
        count integer DEFAULT 1
    );

    ALTER TABLE rate_limit.records_aggregated
    DROP CONSTRAINT records_aggregated_pkey;

    ALTER TABLE rate_limit.records_aggregated
    ADD CONSTRAINT unique_session_key UNIQUE (session_id, key);

    CREATE OR REPLACE FUNCTION rate_limit.agg_increment(key_ text, prefix text, window_ms double precision, reference_time timestamptz DEFAULT now())
    RETURNS record AS
    $bd$
        DECLARE
            in_session_id uuid;
            in_session_expiration timestamptz;
            session_type text = 'aggregated';
            record_count int = 0;
            ret RECORD;
        BEGIN

        Lock table rate_limit.sessions;
        
        SELECT id, expires_at
        FROM rate_limit.session_select($2, session_type)
        WHERE expires_at > $4
        INTO in_session_id, in_session_expiration;
    
        IF in_session_id is null THEN
            in_session_expiration = to_timestamp(extract (epoch from $4)+ $3/1000.0);
            SELECT id, in_session_expiration
            FROM rate_limit.session_reset(
                $2, session_type, in_session_expiration
            ) 
            INTO in_session_id;
        END IF;


        INSERT INTO rate_limit.records_aggregated(key, session_id)
        VALUES ($1, in_session_id)
        ON CONFLICT ON CONSTRAINT unique_session_key DO UPDATE
        SET count = records_aggregated.count + 1
        RETURNING count INTO record_count;
    
        ret:= (record_count, in_session_expiration);

        RETURN ret;
        END; 
    $bd$
    LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION rate_limit.agg_decrement(key_ text, prefix text, reference_time timestamptz DEFAULT now())
    RETURNS void AS
    $bd$
        DECLARE 
            in_session_id uuid;
            session_type text = 'aggregated';
        BEGIN
        
        SELECT id
        FROM rate_limit.session_select($2, session_type)
        WHERE expires_at > $3
        INTO in_session_id;

        UPDATE rate_limit.records_aggregated
        SET count = greatest(0, count-1)
        WHERE key = $1 and session_id = in_session_id;
        END;
    $bd$
    LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION rate_limit.agg_reset_key(key_ text, prefix text, reference_time timestamptz DEFAULT now())
    RETURNS void AS
    $bd$
        DECLARE 
            in_session_id uuid;
            session_type text = 'aggregated';
        BEGIN
        
        SELECT id
        FROM rate_limit.session_select($2, session_type)
        WHERE expires_at > $3
        INTO in_session_id;

        DELETE FROM rate_limit.records_aggregated
        WHERE key = $1 and session_id = in_session_id;
        END;
    $bd$
    LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION rate_limit.agg_reset_session(prefix text, reference_time timestamptz DEFAULT now())
    RETURNS void AS
    $bd$
        DECLARE 
            in_session_id uuid;
            session_type text = 'aggregated';
        BEGIN
        
        SELECT id
        FROM rate_limit.session_select($1, session_type)
        WHERE expires_at > $2
        INTO in_session_id;

        DELETE FROM rate_limit.records_aggregated
        WHERE session_id = in_session_id;
        END;
    $bd$
    LANGUAGE plpgsql;
`
export const detailedRecordsQuery = `
    CREATE TABLE IF NOT EXISTS rate_limit.individual_records (
        id uuid DEFAULT uuid_generate_v1() PRIMARY KEY,
        key text,
        event_time timestamptz DEFAULT now(),
        session_id uuid REFERENCES rate_limit.sessions (id) ON DELETE CASCADE
    );

    CREATE OR REPLACE FUNCTION rate_limit.ind_increment(key_ text, prefix text, window_ms double precision, reference_time timestamptz DEFAULT now())
    RETURNS record AS
    $bd$
        DECLARE
            in_session_id uuid;
            in_session_expiration timestamptz;
            session_type text = 'individual';
            record_count int = 0;
            ret RECORD;
        BEGIN

        LOCK TABLE rate_limit.sessions;
        
        SELECT id, expires_at
        FROM rate_limit.session_select($2, session_type)
        WHERE expires_at > $4
        INTO in_session_id, in_session_expiration;
    
        IF in_session_id is null THEN
            in_session_expiration = to_timestamp(extract (epoch from $4)+ $3/1000.0);
            SELECT id, in_session_expiration
            FROM rate_limit.session_reset(
                $2, session_type, in_session_expiration
            ) 
            INTO in_session_id;
        END IF;


        INSERT INTO rate_limit.individual_records(key, session_id) VALUES ($1, in_session_id);
        
        SELECT count(id)::int AS count FROM rate_limit.individual_records WHERE key = $1 AND session_id = in_session_id
        INTO record_count;
    
        ret:= (record_count, in_session_expiration);

        RETURN ret;
        END; 
    $bd$
    LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION rate_limit.ind_decrement(key_ text, prefix text, reference_time timestamptz DEFAULT now())
    RETURNS void AS
    $bd$
        DECLARE 
            in_session_id uuid;
            session_type text = 'individual';
        BEGIN
        
        SELECT id
        FROM rate_limit.session_select($2, session_type)
        WHERE expires_at > $3
        INTO in_session_id;

        WITH 
        rows_to_delete AS (
            SELECT id FROM rate_limit.individual_records
            WHERE key = $1 and session_id = in_session_id ORDER BY event_time LIMIT 1
            )
        DELETE FROM rate_limit.individual_records 
        USING rows_to_delete WHERE individual_records.id = rows_to_delete.id;
        END;
    $bd$
    LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION rate_limit.ind_reset_key(key_ text, prefix text, reference_time timestamptz DEFAULT now())
    RETURNS void AS
    $bd$
        DECLARE 
            in_session_id uuid;
            session_type text = 'individual';
        BEGIN
        
        SELECT id
        FROM rate_limit.session_select($2, session_type)
        WHERE expires_at > $3
        INTO in_session_id;

        DELETE FROM rate_limit.individual_records
        WHERE key = $1 AND session_id = in_session_id;
        END;
    $bd$
    LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION rate_limit.ind_reset_session(prefix text, reference_time timestamptz DEFAULT now())
    RETURNS void AS
    $bd$
        DECLARE 
            in_session_id uuid;
            session_type text = 'individual';
        BEGIN
        
        SELECT id
        FROM rate_limit.session_select($1, session_type)
        WHERE expires_at > $2
        INTO in_session_id;

        DELETE FROM rate_limit.individual_records
        WHERE session_id = in_session_id;
        END;
    $bd$
    LANGUAGE plpgsql;
`
