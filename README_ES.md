[English](README.md) · **Español** · [Technical README](TECHNICAL_README.md)

# Veridra

Alguien puede mostrarte un hash de transacción o una captura de pago convincente. Eso no responde la pregunta útil: **¿la evidencia onchain respalda el pago que afirma haber ocurrido?**

Veridra es un proyecto de hackathon en su etapa inicial. La idea de producto es verificar afirmaciones de pago en Monad: comparar una afirmación estructurada con evidencia de una transacción y expresar qué respalda la evidencia, qué contradice y qué no se pudo establecer. El componente onchain se pretende escribir en Solidity. La fuente de evidencia y el límite entre el trabajo onchain y offchain siguen siendo decisiones de diseño abiertas.

## Un ejemplo concreto

El ejemplo describe el comportamiento deseado; no es una demo ejecutable.

```text
Afirmación: se transfirieron 100 USDC de Alice a Bob
Evidencia: la transacción tuvo éxito; se encontró una transferencia del token que coincide
Resultado: VERIFIED para esos hechos del ledger
```

Si la transferencia fue a otra dirección, el resultado debería ser `NOT_VERIFIED`. Si no se puede obtener o interpretar la transacción o la evidencia relevante, debería ser `INSUFFICIENT_EVIDENCE`. Que una transacción haya tenido éxito no demuestra por sí solo cualquier afirmación de pago.

## Qué significa el resultado

Veridra se limita a hechos que puedan vincularse con la evidencia de la cadena seleccionada. El resultado del ledger no establece por sí solo quién controlaba una wallet, si una factura quedó legalmente saldada ni si se entregaron bienes o servicios. Una afirmación solo puede verificarse hasta donde lo permitan los datos de la transacción y la fuente de evidencia elegida.

El producto todavía no está implementado. Este checkout no contiene contratos Solidity, una demo ejecutable, un endpoint desplegado ni resultados de pruebas. Consulta el [diseño técnico y las decisiones abiertas](TECHNICAL_README.md).

## Destino y niveles

El destino es un servicio de verificación que comercios, marketplaces y agentes automatizados puedan usar para contrastar una afirmación de pago con evidencia autenticada de Monad y recibir un resultado reproducible cuyo alcance esté claramente delimitado. El proyecto avanzará hacia ese destino en niveles completos:

| Nivel | Estado del producto |
|---|---|
| 1 | Verificar una afirmación sobre un pago Monad soportado; al principio, una transferencia directa de MON nativo o de un token ERC-20. Las formas de transacción no soportadas producen evidencia insuficiente. |
| 2 | Emitir un recibo de evidencia versionado que otro verificador pueda comprobar de forma independiente, incluida la fuente de evidencia y el alcance exacto del resultado. |
| 3 | Permitir que quien paga o recibe registre una expectativa de pago autorizada antes de la liquidación, para vincular una referencia o fecha límite con evidencia previa en vez de inferirla de una transferencia. |
| 4 | Ofrecer a un comercio o marketplace concreto una API y un flujo de usuario para consumir recibos de forma segura, incluyendo solicitudes duplicadas y reorganizaciones de la cadena. |
| 5 | Ampliar las formas de transacción y la comparación de disputas solo cuando se pueda reconstruir cada transferencia soportada y limitar cada resultado a su evidencia. |
| 6 (opcional) | Ofrecer un recibo privado solo si un usuario real necesita demostrar una policy sobre términos comerciales privados sin revelarlos, y una prueba ZK oculta información adicional a la que ya expone el ledger público. |

Cada nivel debe ser útil por sí mismo e incluir las reglas de integridad, autoridad y manejo de errores que necesita el destino. Si se acaba el tiempo del hackathon, el proyecto se detendrá en el nivel completo más alto alcanzado, en lugar de entregar versiones más débiles de los niveles intentados. El nivel 6 puede omitirse sin afectar la receipt normal. El [Technical README](TECHNICAL_README.md) describe los límites entre niveles y sus invariantes compartidos.

## Flujo previsto

1. La persona ingresa un hash de transacción de Monad y los hechos del pago que quiere comprobar.
2. Veridra obtiene y normaliza la evidencia de la transacción.
3. Cada hecho afirmado se compara con la evidencia y recibe `PASS`, `FAIL` o `ABSTAIN`.
4. El resultado diferencia entre una afirmación respaldada, una contradicha y evidencia insuficiente.

Todavía no se eligió el modelo exacto para obtener y verificar la evidencia. Los contratos inteligentes no pueden leer directamente logs históricos; cualquier diseño que use evidencia de transacciones pasadas debe explicar cómo se autentica. Las alternativas y sus implicancias para el límite de Solidity están en el [Technical README](TECHNICAL_README.md).

## Estado actual

La dirección de producto toma como referencia el proyecto local PROOF, cuya implementación existente verifica afirmaciones de pago de Stellar en Python. Veridra es una nueva dirección de implementación, no un port de ese código fuente. Ningún comportamiento descrito aquí fue implementado o verificado de forma independiente en este repositorio.

Para la arquitectura, los límites de confianza, las decisiones y las formas de refutar el diseño, consulta el **[Technical README](TECHNICAL_README.md)**.
