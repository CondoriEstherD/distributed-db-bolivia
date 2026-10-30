-- =============================================================================
-- 05 · Lógica de negocio local. Una venta es una transacción 100 % local:
-- valida catálogo (réplica), cliente (FC1) y stock del propio nodo. No usa la WAN.
-- =============================================================================

-- p_items: [{"id_producto": 15, "cantidad": 2}, ...]
CREATE FUNCTION registrar_venta(p_departamento CHAR(2), p_id_cliente BIGINT,
                                p_id_empleado INT, p_items JSONB)
RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE
    v_id_venta BIGINT;
    v_item     JSONB;
    v_producto INT;
    v_cantidad INT;
    v_precio   NUMERIC(10,2);
    v_almacen  INT;
BEGIN
    IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'La venta debe tener al menos un producto';
    END IF;

    INSERT INTO ventas (departamento_id, id_cliente, id_empleado)
    VALUES (p_departamento, p_id_cliente, p_id_empleado)
    RETURNING id_venta INTO v_id_venta;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_producto := (v_item ->> 'id_producto')::INT;
        v_cantidad := (v_item ->> 'cantidad')::INT;

        SELECT precio_unitario INTO v_precio
        FROM productos_catalogo WHERE id_producto = v_producto;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Producto % inexistente en el catálogo', v_producto;
        END IF;

        -- Primer almacén del departamento con stock suficiente (fila bloqueada).
        SELECT i.id_almacen INTO v_almacen
        FROM inventario i
        JOIN almacenes a USING (id_almacen)
        WHERE a.departamento_id = p_departamento
          AND i.id_producto = v_producto
          AND i.stock_actual >= v_cantidad
        ORDER BY i.id_almacen
        LIMIT 1
        FOR UPDATE OF i;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Stock insuficiente del producto % en %', v_producto, p_departamento;
        END IF;

        UPDATE inventario SET stock_actual = stock_actual - v_cantidad
        WHERE id_almacen = v_almacen AND id_producto = v_producto;

        INSERT INTO detalle_venta (id_venta, id_producto, cantidad, precio_aplicado)
        VALUES (v_id_venta, v_producto, v_cantidad, v_precio);
    END LOOP;

    UPDATE ventas
    SET total_bs = (SELECT sum(subtotal) FROM detalle_venta WHERE id_venta = v_id_venta)
    WHERE id_venta = v_id_venta;

    RETURN v_id_venta;
END $$;

-- Venta de demostración: cliente y productos aleatorios del departamento indicado.
CREATE FUNCTION venta_demo(p_departamento CHAR(2), p_id_empleado INT DEFAULT 1)
RETURNS TABLE (id_venta BIGINT, departamento_id CHAR(2), total_bs NUMERIC, productos INT)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
    v_cliente BIGINT;
    v_items   JSONB;
    v_id      BIGINT;
BEGIN
    SELECT c.id_cliente INTO v_cliente
    FROM clientes_datos_generales c
    WHERE c.departamento_id = p_departamento
    ORDER BY random() LIMIT 1;
    IF v_cliente IS NULL THEN
        RAISE EXCEPTION 'El departamento % no pertenece a este nodo', p_departamento;
    END IF;

    SELECT jsonb_agg(jsonb_build_object('id_producto', x.id_producto,
                                        'cantidad', 1 + floor(random() * 3)::int))
    INTO v_items
    FROM (SELECT id_producto FROM productos_catalogo ORDER BY random() LIMIT 3) x;

    v_id := registrar_venta(p_departamento, v_cliente, p_id_empleado, v_items);

    RETURN QUERY
    SELECT v.id_venta, v.departamento_id, v.total_bs,
           (SELECT count(*)::int FROM detalle_venta d WHERE d.id_venta = v.id_venta)
    FROM ventas v WHERE v.id_venta = v_id;
END $$;
