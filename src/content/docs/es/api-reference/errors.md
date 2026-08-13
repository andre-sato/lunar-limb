---
title: Errores
description: Códigos de estado HTTP y estructuras de error devueltas por la API.
sidebar:
  order: 3
---

Los errores deben usar códigos HTTP estandarizados y un cuerpo JSON que permita identificar y corregir el problema.

```json
{
  "error": {
    "code": "invalid_request",
    "message": "El campo email debe contener una dirección válida.",
    "request_id": "req_01HXYZ123"
  }
}
```

| Estado | Cuándo ocurre | Próxima acción |
| --- | --- | --- |
| `400` | La solicitud es inválida. | Revisa campos, formatos y valores enviados. |
| `401` | La credencial no fue reconocida. | Valida o renueva el token. |
| `403` | La credencial no tiene el permiso necesario. | Solicita el alcance adecuado. |
| `404` | El recurso no existe o no está disponible. | Confirma el identificador y el entorno. |
| `429` | Se alcanzó el límite de llamadas. | Aplica una espera progresiva y vuelve a intentarlo. |
| `500` | Ocurrió un fallo inesperado de la plataforma. | Vuelve a intentarlo e informa el `request_id` al soporte. |

:::note
Nunca expongas detalles internos, secretos o datos personales en mensajes de error. El `request_id` es la forma segura de correlacionar un incidente con el soporte.
:::
