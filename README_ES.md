[English](README.md) · **Español** · [Technical README](TECHNICAL_README.md)

# Veridra

Alguien puede mostrarte un hash de transacción o una captura de pago convincente. Eso no responde la pregunta útil: **¿la evidencia onchain respalda el pago que afirma haber ocurrido?**

Veridra verifica afirmaciones de pago en Monad: compara una afirmación estructurada con evidencia de una transacción y expresa qué respalda, qué contradice y qué no se pudo establecer. Los primeros contratos Solidity implementan adjudicación determinista y un registro inmutable de recibos para un publisher autorizado. La adquisición RPC y la extracción de transacciones siguen siendo trabajo offchain; los contratos no autentican la respuesta del RPC del publisher.

## Un ejemplo concreto

El ejemplo es ilustrativo (un pago en token para el que el Nivel 1 todavía no tiene evidencia en vivo); un ejemplo real, corrido en vivo contra Monad testnet con una transferencia nativa de MON, está en "En vivo en Monad testnet" más abajo.

```text
Afirmación: se transfirieron 100 USDC de Alice a Bob
Evidencia: la transacción tuvo éxito; se encontró una transferencia del token que coincide
Resultado: VERIFIED para esos hechos del ledger
```

Si la transferencia fue a otra dirección, el resultado debería ser `NOT_VERIFIED`. Si no se puede obtener o interpretar la transacción o la evidencia relevante, debería ser `INSUFFICIENT_EVIDENCE`. Que una transacción haya tenido éxito no demuestra por sí solo cualquier afirmación de pago.

## Qué significa el resultado

Veridra se limita a hechos que puedan vincularse con la evidencia de la cadena seleccionada. El resultado del ledger no establece por sí solo quién controlaba una wallet, si una factura quedó legalmente saldada ni si se entregaron bienes o servicios. Una afirmación solo puede verificarse hasta donde lo permitan los datos de la transacción y la fuente de evidencia elegida.

El núcleo de contratos del Nivel 1 y la biblioteca TypeScript de adquisición y publicación RPC están implementados. Los contratos compilan con Solidity 0.8.24 usando la configuración `via_ir` del repositorio. 41 tests de Foundry (`forge test`) ejercitan el adjudicador, el registry, el verificador de inclusión reciente y su script de despliegue protegido; 53 tests de Node.js (`npm test` en `offchain/`) ejercitan parsing de afirmaciones, adquisición RPC, construcción de pruebas, extracción de hechos de pago, exportación/reverificación de recibos portátiles, límites del cliente de inclusión y verificación independiente. Un CLI mínimo (`node dist/cli.js verify <receiptId> ...` / `publish ...`) envuelve la biblioteca de adquisición, publicación y verificación independiente, y ya corrió en vivo contra Monad testnet — ver "En vivo en Monad testnet" más abajo. Consulta el [diseño técnico y las decisiones abiertas](TECHNICAL_README.md).

El primer camino de evidencia tiene un alcance deliberado: el Nivel 1 usa evidencia obtenida por RPC y atribuye explícitamente su fuente. El recibo no afirma que sea trustless. Los niveles posteriores fortalecen la autenticación de esa misma evidencia sin cambiar el significado de una afirmación de pago. El [registro de decisiones arquitectónicas](docs/ARCHITECTURE_FRACTURE.md) explica la progresión y sus límites.

## Destino y niveles

El destino es un servicio de verificación que comercios, marketplaces y agentes automatizados puedan usar para contrastar una afirmación de pago con evidencia de Monad y conocer explícitamente su nivel de garantía, junto con un resultado reproducible y de alcance delimitado. El proyecto avanzará hacia ese destino en niveles completos:

| Nivel | Estado del producto |
|---|---|
| 1 | Verificar una afirmación sobre un pago Monad soportado usando evidencia RPC con atribución explícita. El recibo identifica proveedor/fuente y contexto de observación; no afirma autenticación histórica trustless. |
| 2 | Emitir un recibo de evidencia portátil y versionado, y comprobar de forma independiente la inclusión reciente de transacción/receipt contra `BLOCKHASH`, mientras el bloque siga dentro de la ventana de 256 bloques. |
| 3 | Preservar la verificación histórica con una fuente persistente de raíces autenticadas, como un light client, oracle o mecanismo de checkpoints con supuestos de confianza explícitos. |
| 4 | Permitir que quien paga o recibe registre una expectativa de pago autorizada antes de la liquidación, para vincular una referencia o fecha límite con evidencia previa en vez de inferirla de una transferencia. |
| 5 | Ofrecer a un comercio o marketplace concreto una API y un flujo de usuario para consumir recibos de forma segura, incluyendo solicitudes duplicadas y reorganizaciones de la cadena. |
| 6 | Ampliar las formas de transacción y la comparación de afirmaciones solo cuando se pueda reconstruir cada transferencia soportada y limitar cada resultado a su evidencia. |
| 7 (opcional) | Ofrecer un recibo privado solo si un usuario real necesita demostrar una policy sobre términos comerciales privados sin revelarlos, y una prueba ZK oculta información adicional a la que ya expone el ledger público. |

Cada nivel debe ser útil por sí mismo e incluir las reglas de integridad, autoridad y manejo de errores que necesita el destino. Si se acaba el tiempo del hackathon, el proyecto se detendrá en el nivel completo más alto alcanzado, en lugar de entregar versiones más débiles de los niveles intentados. El nivel privado opcional (7) puede omitirse sin afectar el recibo normal. El [Technical README](TECHNICAL_README.md) describe los límites entre niveles y sus invariantes compartidos.

## Flujo previsto

1. La persona ingresa un hash de transacción de Monad y los hechos del pago que quiere comprobar.
2. Veridra obtiene y normaliza la evidencia de la transacción.
3. Cada hecho afirmado se compara con la evidencia y recibe `PASS`, `FAIL` o `ABSTAIN`.
4. El resultado diferencia entre una afirmación respaldada, una contradicha y evidencia insuficiente.

La comparación de afirmaciones permanece estable mientras mejora la autenticación de evidencia. Cada recibo separa el `verdict` acotado de la etiqueta `evidence_assurance`: por ejemplo, `VERIFIED` respecto de la evidencia obtenida puede coexistir con `RPC_ATTESTED`. Los contratos inteligentes no pueden leer logs históricos directamente; el modelo y sus límites están en el [Technical README](TECHNICAL_README.md).

La biblioteca offchain y sus instrucciones están en [`offchain/README.md`](offchain/README.md).

Los montos son enteros exactos en la unidad mínima del activo. No se usa aritmética de punto flotante.

## Desplegando en Monad testnet

```bash
cp .env.example .env   # completá PRIVATE_KEY (una cuenta de Monad testnet fondeada)
source .env

forge script script/Deploy.s.sol \
  --rpc-url monad_testnet \
  --broadcast \
  --verify --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/
```

Necesita una cuenta de Monad testnet fondeada con MON desde [faucet.monad.xyz](https://faucet.monad.xyz). `.env` está en `.gitignore`; nunca lo commitees.

## En vivo en Monad testnet

`VeridraReceiptRegistry` está desplegado y verificado en Sourcify (`exact_match`) en
[`0x2a78a4542CC70929DCd8e7a8dE096588F7607f61`](https://testnet.monadexplorer.com/address/0x2a78a4542CC70929DCd8e7a8dE096588F7607f61),
publisher `0x298b1699B81660B027aF05A70b3B10CCaCdd2063`.

Ejercitado en vivo de punta a punta contra una transacción real — una transferencia nativa de 0.01 MON,
[`0x27d5f9bd45f4022cd87a343c29218e4d6671fbfad626aeafe56fd28f5142fba6`](https://testnet.monadexplorer.com/tx/0x27d5f9bd45f4022cd87a343c29218e4d6671fbfad626aeafe56fd28f5142fba6) — por el camino feliz y el adversarial:

| Afirmación contra la misma transacción real | Resultado del CLI `verify` |
|---|---|
| Sender, recipient y amount correctos | `VERIFIED`, todos los checks afirmados en `PASS` |
| Sender y amount correctos, recipient deliberadamente incorrecto | `NOT_VERIFIED`, check `recipient` en `FAIL`, el resto de los checks afirmados en `PASS` |

Ambos recibos fueron re-verificados de forma independiente con `node dist/cli.js verify <receiptId>` — una recomputación en TypeScript hecha desde cero, no una segunda llamada a la misma lógica del contrato — y coincidieron con lo que el registry tenía almacenado en los dos casos.

El verificador separado del Nivel 2 está desplegado en
[`0x6f0512740A569a4EF2e3f148513866Df97D5E0a8`](https://testnet.monadexplorer.com/address/0x6f0512740A569a4EF2e3f148513866Df97D5E0a8)
con runtime code hash `0xa4d1836d69eedbf3f90b5ef986e583b35153487d9cf06983fd90a8695fd0d80e`.
El despliegue tuvo éxito en el bloque `67709091` y usó 3.634.723 gas
(`0,374376469003634723 MON` pagados).

Las pruebas en vivo de inclusión y recibo portable incluyen una transferencia
nativa de 1 wei en el bloque `67710927` (2026-10-02) y otra EIP-1559 de 10 wei
en el bloque `67849839` (2026-10-03)
([segunda transacción](https://testnet.monadexplorer.com/tx/0x22b9176c5bc9bbbe2909163275788db04ab5b9fd87492a793a134c8eeb280753)).
Sobre la segunda prueba, afirmar el monto correcto dio `VERIFIED`; afirmar
deliberadamente 11 wei dio `NOT_VERIFIED` con solo `amount` en fallo, mientras
ambos recibos portables pasaron el verificador de inclusión desplegado. Una
autotransferencia EIP-1559 separada de 1 wei también pasó de punta a punta. La
adquisición y las verificaciones del consumer usaron el mismo RPC público, por
lo que estas ejecuciones no demuestran comportamiento con proveedores
independientes ni respuestas RPC autenticadas. El comportamiento en vivo de
ERC-20 sigue sin probarse y el Nivel 2 todavía no está completo.

## Estado actual

La dirección de producto adapta semánticas útiles de PROOF —afirmaciones explícitas, `PASS` / `FAIL` / `ABSTAIN` y veredictos generales distintos— a evidencia de transacciones EVM. Veridra se implementa en Solidity y TypeScript; no es un port del código fuente. Se ejecutaron y pasaron la compilación Solidity, el chequeo de tipos TypeScript, 41 tests de Foundry y 53 tests de Node.js. El pipeline completo del Nivel 1 —adquisición de evidencia RPC, publicación onchain y verificación independiente— también corrió en vivo contra una transacción real de Monad testnet y el registry desplegado arriba, tanto en el camino `VERIFIED` como en el `NOT_VERIFIED`. El Nivel 2 ya tiene varias pruebas en vivo de transferencias nativas, incluida una EIP-1559 y una pareja de afirmaciones de monto correcto/incorrecto sobre la misma prueba. Todas usaron el mismo RPC público; no autentican al proveedor de forma independiente. El comportamiento ERC-20 en vivo y con un segundo proveedor sigue sin probarse, así que el Nivel 2 continúa incompleto. El pin y los IDs de fuente son etiquetas declaradas por callers: no autentican el RPC que entrega el bytecode, las pruebas o el resultado de `eth_call`. Los niveles 3–7 (historial de raíces persistentes, expectativas de pago previas, integración con un comercio, formas de transacción adicionales y recibo privado opcional) todavía no están construidos.

Para la arquitectura, los límites de confianza, las decisiones y las formas de refutar el diseño, consulta el **[Technical README](TECHNICAL_README.md)**.

## Licencia

Apache-2.0 — ver [`LICENSE`](LICENSE). Las reglas del Monad Hackathon exigen una licencia aprobada por OSI (MIT, Apache 2.0, GPL o similar) mantenida públicamente accesible en GitHub durante y después del hackathon.
