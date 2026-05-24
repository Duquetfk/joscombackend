const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
console.log(">>> [SISTEMA JOSCOM] Cargando rutas nuevas... v2");
app.use(cors());
app.use(express.json());

// --- CONFIGURACIÓN DE MULTER (FOTOS) ---
const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)){ fs.mkdirSync(uploadDir); }

const storage = multer.diskStorage({
    destination: (req, file, cb) => { cb(null, 'uploads/'); },
    filename: (req, file, cb) => { cb(null, Date.now() + path.extname(file.originalname)); }
});
const upload = multer({ storage: storage });
app.use('/uploads', express.static('uploads'));

// --- CONEXIÓN BD ---
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',      
    password: 'Emmanuelpp12', 
    database: 'joscom_taller' 
});

db.connect(err => {
    if (err) { console.error('❌ Error BD:', err); return; }
    console.log('✅ Conectado a joscom_taller');
});

// ========== RUTAS DE USUARIOS ==========
app.post('/login', (req, res) => {
    const { usuario, contrasena } = req.body;
    const query = 'SELECT id_usuario, nombre, rol FROM usuario WHERE usuario = ? AND contrasena = ?';
    db.query(query, [usuario, contrasena], (err, results) => {
        if (err) return res.status(500).json(err);
        if (results.length > 0) {
            res.json({ success: true, ...results[0] });
        } else {
            res.status(401).json({ success: false });
        }
    });
});

app.post('/usuarios', (req, res) => {
    const { nombre, usuario, contrasena, rol } = req.body;
    const query = 'INSERT INTO usuario (nombre, usuario, contrasena, rol, estado) VALUES (?, ?, ?, ?, "Activo")';
    db.query(query, [nombre, usuario, contrasena, rol], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ success: true });
    });
});

app.get('/usuarios', (req, res) => {
    db.query('SELECT id_usuario, nombre, usuario, rol, estado FROM usuario', (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.put('/usuarios/:id/estado', (req, res) => {
    const { nuevoEstado } = req.body;
    const { id } = req.params;
    const query = 'UPDATE usuario SET estado = ? WHERE id_usuario = ?';
    db.query(query, [nuevoEstado, id], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ success: true });
    });
});

// ========== RUTAS DE CLIENTES ==========
app.get('/clientes/:telefono', (req, res) => {
    const { telefono } = req.params;
    const query = `SELECT COUNT(*) as visitas, cliente_nombre FROM servicio WHERE cliente_telefono = ?`;
    db.query(query, [telefono], (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results[0]);
    });
});

// ========== RUTAS DE SERVICIOS ==========
app.post('/servicios', upload.array('fotos', 5), (req, res) => {
    const { 
        cliente, telefono, tipo_equipo, marca, modelo, 
        num_serie, password_equipo, falla, accesorios, 
        presupuesto, id_usuario, fecha_ingreso, fecha_estimada, anticipo 
    } = req.body;

    const fotos_nombres = req.files ? req.files.map(f => f.filename).join(',') : null;
    const p = parseFloat(presupuesto) || 0;
    const a = parseFloat(anticipo) || 0;

    const query = `INSERT INTO servicio (cliente_nombre, cliente_telefono, tipo_equipo, marca, modelo, num_serie, password_equipo, falla_reportada, accesorios, presupuesto, id_usuario, foto_evidencia, fecha_ingreso, fecha_estimada, anticipo) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    
    db.query(query, [
        cliente, telefono, tipo_equipo, marca, modelo, 
        num_serie, password_equipo, falla, accesorios, 
        p, id_usuario, fotos_nombres, fecha_ingreso, fecha_estimada, a
    ], (err, result) => {
        if (err) {
            console.error("❌ Error en INSERT servicio:", err.sqlMessage);
            return res.status(500).json({ error: err.sqlMessage });
        }
        res.json({ success: true, id: result.insertId });
    });
});

app.get('/servicios', (req, res) => {
    const query = `
        SELECT s.*, u.nombre as tecnico_nombre 
        FROM servicio s 
        LEFT JOIN usuario u ON s.id_usuario = u.id_usuario 
        ORDER BY s.id_servicio DESC`;
    db.query(query, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

// RUTA ACTUALIZADA: PUT /servicios/:id - Soporta entrega con método de pago
app.put('/servicios/:id', (req, res) => {
    const id = req.params.id;
    const { nuevoEstado, informe_tecnico, falla_reportada, presupuesto, cliente_nombre, metodo_pago } = req.body;
    
    let query = `
        UPDATE servicio 
        SET estado = IFNULL(?, estado), 
            informe_tecnico = IFNULL(?, informe_tecnico),
            falla_reportada = IFNULL(?, falla_reportada),
            presupuesto = IFNULL(?, presupuesto),
            cliente_nombre = IFNULL(?, cliente_nombre)
    `;
    
    const params = [nuevoEstado || null, informe_tecnico || null, falla_reportada || null, presupuesto || null, cliente_nombre || null];
    
    if (nuevoEstado === 'Entregado') {
        query += `, fecha_entrega = IFNULL(NOW(), fecha_entrega), metodo_pago = IFNULL(?, metodo_pago)`;
        params.push(metodo_pago || null);
    }
    
    query += ` WHERE id_servicio = ?`;
    params.push(id);
    
    db.query(query, params, (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ success: true, affected: result.affectedRows });
    });
});

// ========== RUTAS DE GARANTÍAS (VERSION CORREGIDA / BLINDADA) ==========
app.post('/garantias', (req, res) => {
    console.log("--- NUEVA PETICIÓN DE GARANTÍA ---");
    console.log("Cuerpo recibido:", req.body);

    const { id_servicio, dias_cobertura, metodo_pago } = req.body;

    if (!id_servicio) {
        console.error("❌ ERROR: id_servicio viene vacío");
        return res.status(400).json({ error: "Falta el ID del servicio" });
    }

    // 1. Insertar la garantía
    const queryGarantia = "INSERT INTO garantia (id_servicio, fecha_inicio, fecha_vencimiento, estado_garantia) VALUES (?, NOW(), DATE_ADD(NOW(), INTERVAL ? DAY), 'Activa')";

    db.query(queryGarantia, [id_servicio, dias_cobertura || 30], (err, result) => {
        if (err) {
            console.error("❌ ERROR SQL EN TABLA GARANTÍAS (Revisa si la tabla existe):", err.sqlMessage);
            return res.status(500).json({ error: "Error en tabla garantia", detalle: err.sqlMessage });
        }

        console.log("✅ Garantía insertada, ID:", result.insertId);

        // 2. Actualizar el servicio: Estado, Fecha de Entrega y Método de Pago
        const queryUpdate = "UPDATE servicio SET estado = 'Entregado', fecha_entrega = NOW(), metodo_pago = ? WHERE id_servicio = ?";
        
        db.query(queryUpdate, [metodo_pago || 'Efectivo', id_servicio], (err, updateResult) => {
            if (err) {
                console.error("❌ ERROR SQL AL ACTUALIZAR SERVICIO:", err.sqlMessage);
                return res.status(500).json({ error: "Error al actualizar servicio", detalle: err.sqlMessage });
            }
            
            console.log("✅ Proceso completado: Equipo Entregado y Cobrado");
            res.json({ success: true, message: "Garantía creada y equipo entregado" });
        });
    });
});

// ========== RUTAS DE GASTOS (LEGACY) ==========
app.post('/gastos', (req, res) => {
    const { tipo, monto, fecha } = req.body;
    const query = `INSERT INTO gasto (tipo, monto, fecha) VALUES (?, ?, ?)`;
    db.query(query, [tipo, monto, fecha || new Date()], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ success: true });
    });
});

// ========== RUTAS DE ESTADÍSTICAS ==========
app.get('/stats', (req, res) => {
    const qEnTaller = "SELECT COUNT(*) as total FROM servicio WHERE UPPER(estado) IN ('RECIBIDO', 'EN REPARACION')";
    const qListos = "SELECT COUNT(*) as total FROM servicio WHERE UPPER(estado) = 'LISTO'";
    const qIngresos = "SELECT (IFNULL(SUM(presupuesto),0) + IFNULL(SUM(anticipo),0)) as total FROM servicio WHERE UPPER(estado) = 'ENTREGADO'";
    const qGastos = "SELECT IFNULL(SUM(monto),0) as total FROM gasto";

    db.query(qEnTaller, (err, r1) => {
        if (err) return res.status(500).json(err);
        db.query(qListos, (err, r2) => {
            if (err) return res.status(500).json(err);
            db.query(qIngresos, (err, r3) => {
                if (err) return res.status(500).json(err);
                db.query(qGastos, (err, r4) => {
                    if (err) return res.status(500).json(err);
                    
                    const ingresosTotal = r3[0].total || 0;
                    const gastosTotal = r4[0].total || 0;

                    res.json({
                        enTaller: r1[0].total || 0,
                        listos: r2[0].total || 0,
                        ingresos: ingresosTotal,
                        gastos: gastosTotal,
                        utilidad: ingresosTotal - gastosTotal
                    });
                });
            });
        });
    });
});

// ========== MÓDULO 7: ESTADÍSTICAS DE DEMANDA (RF-33) ==========
app.get('/stats/demanda', (req, res) => {
    const query = `
        SELECT marca, COUNT(*) as cantidad 
        FROM servicio 
        WHERE UPPER(estado) != 'CANCELADO'
        GROUP BY marca 
        ORDER BY cantidad DESC 
        LIMIT 5
    `;

    db.query(query, (err, results) => {
        if (err) {
            console.error("❌ Error en stats demanda:", err);
            return res.status(500).json({ error: "Error al calcular demanda" });
        }
        res.json(results);
    });
});

// ========== RUTAS DE INVENTARIO Y REFACCIONES ==========
app.get('/inventario', (req, res) => {
    db.query('SELECT * FROM refaccion', (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.get('/refacciones-taller', (req, res) => {
    const query = 'SELECT id_refaccion, nombre, precio_venta, stock FROM refaccion WHERE stock > 0 ORDER BY nombre';
    db.query(query, (err, results) => {
        if (err) {
            console.error("Error en /refacciones-taller:", err);
            return res.status(500).json({ error: "Error al obtener refacciones" });
        }
        res.json(results);
    });
});

// ========== NUEVA RUTA: REGISTRAR NUEVA REFACCIÓN ==========
app.post('/inventario', (req, res) => {
    const { nombre, costo_compra, precio_venta, stock } = req.body;
    
    if (!nombre) return res.status(400).json({ error: "Nombre requerido" });

    const query = "INSERT INTO refaccion (nombre, costo_compra, precio_venta, stock) VALUES (?, ?, ?, ?)";
    db.query(query, [nombre, costo_compra, precio_venta, stock || 0], (err, result) => {
        if (err) {
            console.error("❌ Error al insertar producto:", err);
            return res.status(500).json(err);
        }
        res.json({ success: true, id: result.insertId });
    });
});

// ========== RUTAS DE DIAGNÓSTICO Y REPARACIÓN ==========
app.get('/notas-tecnico/:id_nota', (req, res) => {
    const { id_nota } = req.params;
    const query = 'SELECT * FROM diagnostico WHERE id_nota = ?';
    db.query(query, [id_nota], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json(result);
    });
});

// Múltiples fotos de reparación
app.post('/servicios/:id/subir-fotos-reparacion', upload.array('fotos_reparacion', 10), (req, res) => {
    const { id } = req.params;
    
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: "No se subieron fotos" });
    }
    
    const fotosNombres = req.files.map(f => f.filename).join(',');
    const query = `UPDATE servicio SET fotos_reparacion = CONCAT(IFNULL(fotos_reparacion, ''), IF(IFNULL(fotos_reparacion, '') = '', '', ','), ?) WHERE id_servicio = ?`;
    
    db.query(query, [fotosNombres, id], (err, result) => {
        if (err) {
            console.error("Error al guardar fotos de reparación:", err);
            return res.status(500).json({ error: "Error al guardar las fotos" });
        }
        res.json({ success: true, fotos: req.files.map(f => f.filename) });
    });
});

// RUTA: POST /servicios/:id/finalizar-reparacion
app.post('/servicios/:id/finalizar-reparacion', async (req, res) => {
    const { id } = req.params;
    const { 
        informe_tecnico, 
        piezasUsadas = [],
        voltaje,
        corriente,
        señales_osciloscopio,
        hallazgos_internos,
        tipo_mantenimiento,
        fotos_reparacion
    } = req.body;

    if (!id) {
        return res.status(400).json({ error: "ID de servicio requerido" });
    }

    const connection = db.promise();
    
    try {
        await connection.beginTransaction();

        const queryUpdateServicio = `
            UPDATE servicio 
            SET estado = 'Listo', 
                informe_tecnico = IFNULL(?, informe_tecnico),
                voltaje = IFNULL(?, voltaje),
                corriente = IFNULL(?, corriente),
                señales_osciloscopio = IFNULL(?, señales_osciloscopio),
                hallazgos_internos = IFNULL(?, hallazgos_internos),
                tipo_mantenimiento = IFNULL(?, tipo_mantenimiento),
                fotos_reparacion = IFNULL(?, fotos_reparacion)
            WHERE id_servicio = ?
        `;
        
        const [updateResult] = await connection.query(queryUpdateServicio, [
            informe_tecnico || null,
            voltaje || null,
            corriente || null,
            señales_osciloscopio || null,
            hallazgos_internos || null,
            tipo_mantenimiento || null,
            fotos_reparacion || null,
            id
        ]);
        
        if (updateResult.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ error: "Servicio no encontrado" });
        }

        let totalPrecioRefacciones = 0;
        
        if (piezasUsadas.length > 0) {
            for (const pieza of piezasUsadas) {
                const { id_refaccion, cantidad = 1 } = pieza;
                
                if (!id_refaccion) {
                    await connection.rollback();
                    return res.status(400).json({ error: "Cada pieza debe tener id_refaccion" });
                }
                
                const [refaccionResult] = await connection.query(
                    'SELECT precio_venta, stock FROM refaccion WHERE id_refaccion = ?',
                    [id_refaccion]
                );
                
                if (refaccionResult.length === 0) {
                    await connection.rollback();
                    return res.status(404).json({ error: `Refacción con id ${id_refaccion} no encontrada` });
                }
                
                const precioVenta = parseFloat(refaccionResult[0].precio_venta);
                const stockActual = refaccionResult[0].stock;
                
                if (stockActual < cantidad) {
                    await connection.rollback();
                    return res.status(400).json({ 
                        error: `Stock insuficiente para la refacción. Disponible: ${stockActual}` 
                    });
                }
                
                const subtotal = precioVenta * cantidad;
                totalPrecioRefacciones += subtotal;
                
                const queryInsertDetalle = `
                    INSERT INTO detalle_reparacion (id_nota, id_refaccion, cantidad, subtotal) 
                    VALUES (?, ?, ?, ?)
                `;
                await connection.query(queryInsertDetalle, [id, id_refaccion, cantidad, subtotal]);
                
                const queryUpdateStock = `
                    UPDATE refaccion SET stock = stock - ? WHERE id_refaccion = ?
                `;
                await connection.query(queryUpdateStock, [cantidad, id_refaccion]);
            }
        }
        
        if (totalPrecioRefacciones > 0) {
            const queryUpdatePresupuesto = `
                UPDATE servicio SET presupuesto = presupuesto + ? WHERE id_servicio = ?
            `;
            await connection.query(queryUpdatePresupuesto, [totalPrecioRefacciones, id]);
        }
        
        await connection.commit();
        
        res.json({ 
            success: true, 
            message: "Reparación finalizada correctamente",
            refaccionesCosto: totalPrecioRefacciones
        });
        
    } catch (error) {
        await connection.rollback();
        console.error("Error en /servicios/:id/finalizar-reparacion:", error);
        res.status(500).json({ error: "Error al finalizar la reparación", details: error.message });
    }
});

app.get('/servicios/:id/refacciones-usadas', (req, res) => {
    const { id } = req.params;
    
    const query = `
        SELECT dr.*, r.nombre, r.precio_venta 
        FROM detalle_reparacion dr
        JOIN refaccion r ON dr.id_refaccion = r.id_refaccion
        WHERE dr.id_nota = ?
        ORDER BY dr.id_detalle DESC
    `;
    
    db.query(query, [id], (err, results) => {
        if (err) {
            console.error("Error en /servicios/:id/refacciones-usadas:", err);
            return res.status(500).json({ error: "Error al obtener refacciones usadas" });
        }
        res.json(results);
    });
});

app.delete('/servicios/:id/refacciones-usadas/:id_detalle', async (req, res) => {
    const { id, id_detalle } = req.params;
    const connection = db.promise();
    
    try {
        await connection.beginTransaction();
        
        const [detalleResult] = await connection.query(
            'SELECT id_refaccion, cantidad, subtotal FROM detalle_reparacion WHERE id_detalle = ? AND id_nota = ?',
            [id_detalle, id]
        );
        
        if (detalleResult.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: "Detalle no encontrado" });
        }
        
        const { id_refaccion, cantidad, subtotal } = detalleResult[0];
        
        await connection.query(
            'UPDATE refaccion SET stock = stock + ? WHERE id_refaccion = ?',
            [cantidad, id_refaccion]
        );
        
        await connection.query(
            'UPDATE servicio SET presupuesto = presupuesto - ? WHERE id_servicio = ?',
            [subtotal, id]
        );
        
        await connection.query(
            'DELETE FROM detalle_reparacion WHERE id_detalle = ?',
            [id_detalle]
        );
        
        await connection.commit();
        res.json({ success: true, message: "Refacción eliminada correctamente" });
        
    } catch (error) {
        await connection.rollback();
        console.error("Error al eliminar refacción:", error);
        res.status(500).json({ error: "Error al eliminar refacción" });
    }
});

// Ruta original de finalizar (compatibilidad)
app.post('/servicios/:id/finalizar', (req, res) => {
    const { id } = req.params;
    const { informe_tecnico, piezasUsadas } = req.body;

    const qInforme = "UPDATE servicio SET informe_tecnico = ?, estado = 'Listo' WHERE id_servicio = ?";
    
    db.query(qInforme, [informe_tecnico, id], (err) => {
        if (err) return res.status(500).json(err);

        if (piezasUsadas && piezasUsadas.length > 0) {
            piezasUsadas.forEach(pieza => {
                db.query("INSERT INTO detalle_reparacion (id_nota, id_refaccion, cantidad) VALUES (?, ?, 1)", [id, pieza.id_refaccion]);
                db.query("UPDATE refaccion SET stock = stock - 1 WHERE id_refaccion = ?", [pieza.id_refaccion]);
            });
        }
        res.json({ success: true });
    });
});

// ========== RUTAS FINANCIERAS (MÓDULO 4) ==========

app.post('/gastos-operativos', (req, res) => {
    const { tipo, monto, fecha, descripcion } = req.body;
    
    if (!tipo || !tipo.trim()) {
        return res.status(400).json({ error: "El concepto del gasto es requerido" });
    }
    
    const montoNum = parseFloat(monto);
    if (isNaN(montoNum) || montoNum <= 0) {
        return res.status(400).json({ error: "El monto debe ser un número positivo" });
    }
    
    const fechaGasto = fecha || new Date().toISOString().split('T')[0];
    
    const query = "INSERT INTO gasto_operativo (tipo, monto, fecha, descripcion) VALUES (?, ?, ?, ?)";
    db.query(query, [tipo.trim(), montoNum, fechaGasto, descripcion || null], (err, result) => {
        if (err) {
            console.error("Error en POST /gastos-operativos:", err);
            return res.status(500).json({ error: "Error al registrar gasto operativo", sqlError: err.message });
        }
        res.json({ success: true, id: result.insertId, message: "Gasto registrado correctamente" });
    });
});

app.get('/gastos-operativos', (req, res) => {
    const query = "SELECT * FROM gasto_operativo ORDER BY fecha DESC LIMIT 10";
    db.query(query, (err, results) => {
        if (err) {
            console.error("Error en GET /gastos-operativos:", err);
            return res.status(500).json({ error: "Error al obtener gastos", sqlError: err.message });
        }
        res.json(results || []);
    });
});

app.delete('/gastos-operativos/:id', (req, res) => {
    const { id } = req.params;
    const query = 'DELETE FROM gasto_operativo WHERE id_gasto = ?';
    db.query(query, [id], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ success: true, affected: result.affectedRows });
    });
});

app.get('/finanzas/dashboard', async (req, res) => {
    const { periodo } = req.query;
    const mes = req.query.mes || new Date().getMonth() + 1;
    const año = req.query.año || new Date().getFullYear();

    try {
        const connection = db.promise();
        let filtroServicios = "";
        let filtroGastos = "";
        let params = [];

        if (periodo === 'dia') {
            filtroServicios = "WHERE estado = 'Entregado' AND DATE(fecha_entrega) = CURDATE()";
            filtroGastos = "WHERE DATE(fecha) = CURDATE()";
        } else if (periodo === 'semana') {
            filtroServicios = "WHERE estado = 'Entregado' AND YEARWEEK(fecha_entrega, 1) = YEARWEEK(CURDATE(), 1)";
            filtroGastos = "WHERE YEARWEEK(fecha, 1) = YEARWEEK(CURDATE(), 1)";
        } else {
            filtroServicios = "WHERE estado = 'Entregado' AND MONTH(fecha_entrega) = ? AND YEAR(fecha_entrega) = ?";
            filtroGastos = "WHERE MONTH(fecha) = ? AND YEAR(fecha) = ?";
            params = [mes, año];
        }

        const [r1] = await connection.query(`SELECT COALESCE(SUM(presupuesto), 0) as total FROM servicio ${filtroServicios}`, params);
        const [r2] = await connection.query(`SELECT COALESCE(SUM(monto), 0) as total FROM gasto_operativo ${filtroGastos} AND tipo = 'VENTA DIRECTA'`, params);
        const [r3] = await connection.query(`SELECT COALESCE(SUM(monto), 0) as total FROM gasto_operativo ${filtroGastos} AND tipo != 'VENTA DIRECTA'`, params);

        let costRef = 0;
        try {
            const [r4] = await connection.query(`SELECT SUM(subtotal) as t FROM detalle_reparacion WHERE id_nota IN (SELECT id_servicio FROM servicio ${filtroServicios})`, params);
            costRef = parseFloat(r4[0]?.t || 0);
        } catch (e) { costRef = 0; }

        const ingBrutos = parseFloat(r1[0]?.total || 0) + parseFloat(r2[0]?.total || 0);
        const gasOp = parseFloat(r3[0]?.total || 0);

        res.json({
            success: true,
            resumen: { 
                ingresos_brutos: ingBrutos,
                gastos_operativos: gasOp,
                costo_refacciones: costRef,
                utilidad_neta: ingBrutos - (gasOp + costRef)
            }
        });
    } catch (error) { 
        res.status(500).json({ error: error.message }); 
    }
});

// ========== MÓDULO 5: VENTAS DIRECTAS (POS) ==========
app.post('/ventas/nueva', async (req, res) => {
    const { productos, id_usuario, metodo_pago, total } = req.body;
    const connection = db.promise();

    try {
        await connection.beginTransaction();
        let totalVenta = total || 0;

        if (productos && productos.length > 0) {
            for (const p of productos) {
                totalVenta += (p.precio_venta * p.cantidad);
                
                const [updateStock] = await connection.query(
                    "UPDATE refaccion SET stock = stock - ? WHERE id_refaccion = ? AND stock >= ?",
                    [p.cantidad, p.id_refaccion, p.cantidad]
                );

                if (updateStock.affectedRows === 0) {
                    throw new Error(`No hay stock suficiente de ${p.nombre}`);
                }
            }
        }

        const desc = `Venta POS - Pago: ${metodo_pago} - Cajero ID: ${id_usuario || 'Sistema'}`;
        const qVenta = "INSERT INTO gasto_operativo (tipo, monto, fecha, descripcion) VALUES (?, ?, NOW(), ?)";
        
        await connection.query(qVenta, ['VENTA DIRECTA', totalVenta, desc]);

        await connection.commit();
        console.log("✅ Venta procesada con éxito");
        res.json({ success: true });

    } catch (error) {
        await connection.rollback();
        console.error("❌ Error en la venta:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== MÓDULO 6: REGISTRAR DIAGNÓSTICO (C.U. 3) ==========
app.put('/servicios/:id/diagnostico', async (req, res) => {
    const { id } = req.params;
    const { 
        voltaje, corriente, señales_osciloscopio, 
        hallazgos_internos, tipo_mantenimiento, presupuesto_estimado 
    } = req.body;

    const query = `
        UPDATE servicio 
        SET voltaje = ?, 
            corriente = ?, 
            señales_osciloscopio = ?, 
            hallazgos_internos = ?, 
            tipo_mantenimiento = ?, 
            presupuesto = ?,
            estado = 'En Reparación' 
        WHERE id_servicio = ?`;

    db.query(query, [
        voltaje, corriente, señales_osciloscopio, 
        hallazgos_internos, tipo_mantenimiento, presupuesto_estimado, id
    ], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ success: true, message: "Diagnóstico registrado y estado actualizado" });
    });
});

// ========== MÓDULO 9: BÚSQUEDA DINÁMICA (RF-40) ==========
app.get('/historial/buscar', (req, res) => {
    const { criterio } = req.query;
    const query = `
        SELECT s.*, u.nombre as tecnico_nombre 
        FROM servicio s 
        LEFT JOIN usuario u ON s.id_usuario = u.id_usuario 
        WHERE s.cliente_nombre LIKE ? 
           OR s.id_servicio LIKE ? 
           OR s.cliente_telefono LIKE ?
        ORDER BY s.fecha_ingreso DESC`;
    
    const busqueda = `%${criterio}%`;
    db.query(query, [busqueda, busqueda, busqueda], (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

// ========== RUTA PARA RECUPERAR CONTRASEÑA ==========
app.post('/usuarios/recuperar', (req, res) => {
    const { usuario, nuevaContrasena } = req.body;

    db.query('SELECT * FROM usuario WHERE usuario = ?', [usuario], (err, results) => {
        if (err) return res.status(500).json(err);
        
        if (results.length === 0) {
            return res.status(404).json({ success: false, error: "El usuario no existe" });
        }

        db.query('UPDATE usuario SET contrasena = ? WHERE usuario = ?', [nuevaContrasena, usuario], (err, result) => {
            if (err) return res.status(500).json(err);
            res.json({ success: true });
        });
    });
});

// ========== INICIO DEL SERVIDOR DINÁMICO (PREPARADO PARA LA NUBE) ==========
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
    console.log(`🚀 Server en puerto ${PORT}`);
});