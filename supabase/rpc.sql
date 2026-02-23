-- Inventory App v3 document RPCs (atomic stock + avg cost updates)
-- Run this file after schema.sql in the Supabase SQL editor.

CREATE OR REPLACE FUNCTION rpc_create_document(
    p_doc_type INTEGER,
    p_doc_date DATE,
    p_description TEXT,
    p_contragent_id INTEGER,
    p_lines JSONB
) RETURNS JSONB AS $$
DECLARE
    v_doc_num TEXT;
    v_doc_id INTEGER;
    v_line JSONB;
    v_good RECORD;
    v_new_avg NUMERIC(10,2);
BEGIN
    IF p_doc_type NOT IN (1, 2) THEN
        RAISE EXCEPTION 'Invalid doc_type: %', p_doc_type;
    END IF;

    IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'p_lines must be a non-empty array';
    END IF;

    IF p_doc_type = 1 THEN
        UPDATE app_settings
        SET next_in_num = next_in_num + 1
        RETURNING 'IN-' || LPAD((next_in_num - 1)::TEXT, 3, '0') INTO v_doc_num;
    ELSE
        UPDATE app_settings
        SET next_out_num = next_out_num + 1
        RETURNING 'OUT-' || LPAD((next_out_num - 1)::TEXT, 3, '0') INTO v_doc_num;
    END IF;

    INSERT INTO documents (doc_type, doc_date, doc_num, description, contragent_id)
    VALUES (p_doc_type, p_doc_date, v_doc_num, p_description, p_contragent_id)
    RETURNING id INTO v_doc_id;

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        SELECT * INTO v_good
        FROM goods
        WHERE id = (v_line->>'good_id')::INTEGER
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Good % not found', (v_line->>'good_id');
        END IF;

        IF (v_line->>'quantity')::NUMERIC <= 0 THEN
            RAISE EXCEPTION 'Line quantity must be > 0';
        END IF;

        IF p_doc_type = 2 THEN
            IF v_good.quantity < (v_line->>'quantity')::NUMERIC THEN
                RAISE EXCEPTION 'Not enough stock for "%" (available: %, requested: %)',
                    v_good.name, v_good.quantity, (v_line->>'quantity')::NUMERIC;
            END IF;

            INSERT INTO doc_lines (doc_id, good_id, quantity, price, cost_at_time)
            VALUES (
                v_doc_id,
                v_good.id,
                (v_line->>'quantity')::NUMERIC,
                (v_line->>'price')::NUMERIC,
                v_good.avg_cost
            );

            UPDATE goods
            SET quantity = quantity - (v_line->>'quantity')::NUMERIC
            WHERE id = v_good.id;

        ELSIF p_doc_type = 1 THEN
            IF (v_good.quantity + (v_line->>'quantity')::NUMERIC) > 0 THEN
                v_new_avg := (
                    v_good.quantity * v_good.avg_cost +
                    (v_line->>'quantity')::NUMERIC * (v_line->>'price')::NUMERIC
                ) / (v_good.quantity + (v_line->>'quantity')::NUMERIC);
            ELSE
                v_new_avg := (v_line->>'price')::NUMERIC;
            END IF;

            INSERT INTO doc_lines (doc_id, good_id, quantity, price, cost_at_time)
            VALUES (
                v_doc_id,
                v_good.id,
                (v_line->>'quantity')::NUMERIC,
                (v_line->>'price')::NUMERIC,
                NULL
            );

            UPDATE goods
            SET
                quantity = quantity + (v_line->>'quantity')::NUMERIC,
                avg_cost = v_new_avg
            WHERE id = v_good.id;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('doc_id', v_doc_id, 'doc_num', v_doc_num);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION rpc_edit_document(
    p_doc_id INTEGER,
    p_doc_date DATE,
    p_description TEXT,
    p_contragent_id INTEGER,
    p_lines JSONB
) RETURNS JSONB AS $$
DECLARE
    v_doc RECORD;
    v_old_line RECORD;
    v_line JSONB;
    v_good RECORD;
    v_new_avg NUMERIC(10,2);
BEGIN
    SELECT * INTO v_doc
    FROM documents
    WHERE id = p_doc_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Document % not found', p_doc_id;
    END IF;

    FOR v_old_line IN
        SELECT * FROM doc_lines WHERE doc_id = p_doc_id ORDER BY id
    LOOP
        SELECT * INTO v_good
        FROM goods
        WHERE id = v_old_line.good_id
        FOR UPDATE;

        IF v_doc.doc_type = 2 THEN
            UPDATE goods
            SET quantity = quantity + v_old_line.quantity
            WHERE id = v_good.id;
        ELSIF v_doc.doc_type = 1 THEN
            IF (v_good.quantity - v_old_line.quantity) > 0 THEN
                v_new_avg := (
                    v_good.quantity * v_good.avg_cost -
                    v_old_line.quantity * v_old_line.price
                ) / (v_good.quantity - v_old_line.quantity);
            ELSE
                v_new_avg := 0;
            END IF;

            UPDATE goods
            SET
                quantity = quantity - v_old_line.quantity,
                avg_cost = v_new_avg
            WHERE id = v_good.id;
        END IF;
    END LOOP;

    DELETE FROM doc_lines WHERE doc_id = p_doc_id;

    UPDATE documents
    SET
        doc_date = p_doc_date,
        description = p_description,
        contragent_id = p_contragent_id
    WHERE id = p_doc_id;

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        SELECT * INTO v_good
        FROM goods
        WHERE id = (v_line->>'good_id')::INTEGER
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Good % not found', (v_line->>'good_id');
        END IF;

        IF v_doc.doc_type = 2 THEN
            IF v_good.quantity < (v_line->>'quantity')::NUMERIC THEN
                RAISE EXCEPTION 'Not enough stock for "%" (available: %, requested: %)',
                    v_good.name, v_good.quantity, (v_line->>'quantity')::NUMERIC;
            END IF;

            INSERT INTO doc_lines (doc_id, good_id, quantity, price, cost_at_time)
            VALUES (
                p_doc_id,
                v_good.id,
                (v_line->>'quantity')::NUMERIC,
                (v_line->>'price')::NUMERIC,
                v_good.avg_cost
            );

            UPDATE goods
            SET quantity = quantity - (v_line->>'quantity')::NUMERIC
            WHERE id = v_good.id;

        ELSIF v_doc.doc_type = 1 THEN
            IF (v_good.quantity + (v_line->>'quantity')::NUMERIC) > 0 THEN
                v_new_avg := (
                    v_good.quantity * v_good.avg_cost +
                    (v_line->>'quantity')::NUMERIC * (v_line->>'price')::NUMERIC
                ) / (v_good.quantity + (v_line->>'quantity')::NUMERIC);
            ELSE
                v_new_avg := (v_line->>'price')::NUMERIC;
            END IF;

            INSERT INTO doc_lines (doc_id, good_id, quantity, price, cost_at_time)
            VALUES (
                p_doc_id,
                v_good.id,
                (v_line->>'quantity')::NUMERIC,
                (v_line->>'price')::NUMERIC,
                NULL
            );

            UPDATE goods
            SET
                quantity = quantity + (v_line->>'quantity')::NUMERIC,
                avg_cost = v_new_avg
            WHERE id = v_good.id;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('doc_id', p_doc_id, 'doc_num', v_doc.doc_num);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION rpc_delete_document(
    p_doc_id INTEGER
) RETURNS JSONB AS $$
DECLARE
    v_doc RECORD;
    v_line RECORD;
    v_good RECORD;
    v_new_avg NUMERIC(10,2);
BEGIN
    SELECT * INTO v_doc
    FROM documents
    WHERE id = p_doc_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Document % not found', p_doc_id;
    END IF;

    FOR v_line IN SELECT * FROM doc_lines WHERE doc_id = p_doc_id ORDER BY id
    LOOP
        SELECT * INTO v_good
        FROM goods
        WHERE id = v_line.good_id
        FOR UPDATE;

        IF v_doc.doc_type = 2 THEN
            UPDATE goods
            SET quantity = quantity + v_line.quantity
            WHERE id = v_good.id;
        ELSIF v_doc.doc_type = 1 THEN
            IF (v_good.quantity - v_line.quantity) > 0 THEN
                v_new_avg := (
                    v_good.quantity * v_good.avg_cost -
                    v_line.quantity * v_line.price
                ) / (v_good.quantity - v_line.quantity);
            ELSE
                v_new_avg := 0;
            END IF;

            UPDATE goods
            SET
                quantity = quantity - v_line.quantity,
                avg_cost = v_new_avg
            WHERE id = v_good.id;
        END IF;
    END LOOP;

    DELETE FROM doc_lines WHERE doc_id = p_doc_id;
    DELETE FROM documents WHERE id = p_doc_id;

    RETURN jsonb_build_object('deleted', p_doc_id);
END;
$$ LANGUAGE plpgsql;

