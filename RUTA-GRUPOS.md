# Planes compartidos — ruta de implementación

Documento de trabajo. Nada de esto está visible en la app todavía.
Los cimientos ya viven en `index.html`, en el objeto `GRUPOS` (busca
"PLANES COMPARTIDOS"). Se enciende cambiando `activo: false` a `true`,
pero antes tienen que existir las etapas 1 y 2.

---

## Qué es un plan compartido

Una tarea con dueño y participantes. "Cena el viernes con Ana", "gym
con Beto los martes". Aparece en el calendario de todos los que la
aceptaron, y cada quien ve quién confirmó.

La decisión de diseño que sostiene todo lo demás: **un plan ajeno
nunca entra a tu lista sin que lo aceptes.** Los planes viven en
`D.planes`, separados de `D.tareas`, y se proyectan sobre el
calendario al vuelo. Si alguien te invita a algo y no respondes, tu
agenda no se ensucia.

---

## Modelo de datos

```js
{
  id: 'a1b2c3d',
  titulo: 'Cena en el centro',
  fecha: '2026-09-12',
  hora: '20:30',
  lugar: 'Plaza Fiesta',
  dueno: 'memo@correo.com',
  invitados: [
    { correo: 'ana@correo.com', estado: 'aceptado' },
    { correo: 'beto@correo.com', estado: 'pendiente' }
  ],
  estado: 'confirmado',   // propuesto | confirmado | cancelado | hecho
  creado: '2026-09-02T20:10:00Z',
  version: 3
}
```

`version` sube en cada edición. Si dos personas editan sin conexión,
gana la versión más alta; a igual versión, gana la más reciente. Eso
ya está resuelto en `GRUPOS.fusionar()`.

---

## Etapa 1 — Respaldo en Supabase

La tabla actual `agendas` guarda una fila por usuario y solo su dueño
la lee. Para compartir hace falta una tabla aparte donde varios
puedan leer la misma fila.

```sql
create table public.planes (
  id uuid primary key default gen_random_uuid(),
  dueno uuid not null references auth.users on delete cascade,
  datos jsonb not null,
  actualizado timestamptz not null default now()
);

create table public.plan_invitados (
  plan_id uuid references public.planes on delete cascade,
  correo text not null,
  usuario_id uuid references auth.users on delete set null,
  estado text not null default 'pendiente',
  primary key (plan_id, correo)
);

alter table public.planes enable row level security;
alter table public.plan_invitados enable row level security;
```

Las políticas son la parte delicada. Un invitado debe poder **leer**
el plan pero solo **editar su propia respuesta**:

```sql
-- el dueño ve y edita todo lo suyo
create policy "dueno total" on public.planes
  for all using (auth.uid() = dueno) with check (auth.uid() = dueno);

-- un invitado puede leer los planes donde fue invitado
create policy "invitado lee" on public.planes
  for select using (exists (
    select 1 from public.plan_invitados i
    where i.plan_id = planes.id
      and i.correo = (select email from auth.users where id = auth.uid())
  ));

-- cada quien responde solo por sí mismo
create policy "responder lo propio" on public.plan_invitados
  for update using (
    correo = (select email from auth.users where id = auth.uid())
  ) with check (
    correo = (select email from auth.users where id = auth.uid())
  );
```

**Ojo con el rendimiento.** Esa subconsulta a `auth.users` corre por
cada fila. Cuando pase de unas decenas de planes hay que guardar el
correo en el token o crear una función `auth.email()` marcada como
`stable`.

**Ojo con la privacidad.** Invitar por correo revela que esa cuenta
existe. Para tres personas conocidas da igual; si esto crece, hay que
invitar por código o por enlace en vez de por correo directo.

---

## Etapa 2 — Sincronización

Hoy la app sube todo `D` en un solo bloque y gana el último que
escribe. Para planes compartidos eso no sirve: si Ana acepta mientras
tú editas la hora, uno de los dos cambios se pierde.

Lo mínimo que hay que cambiar:

1. Los planes se sincronizan **por plan**, no dentro del bloque `D`.
2. Al abrir la app, traer los planes donde soy dueño o invitado.
3. Aceptar o rechazar escribe únicamente en `plan_invitados`, que es
   una fila diminuta y no pisa nada más.
4. Suscribirse a Realtime de Supabase para que la confirmación de Ana
   aparezca sin recargar. Es una línea, y aquí sí vale la pena.

---

## Etapa 3 — Interfaz

En orden de construcción:

1. **Bandeja de invitaciones.** Un contador en la pestaña Inicio con
   los planes que esperan tu respuesta. Sin esto lo demás no se usa,
   porque nadie se entera de que lo invitaron.
2. **Crear plan.** Reutilizar el modal de tarea agregando hora, lugar
   y campo de invitados. No inventar una pantalla nueva.
3. **Marca en el calendario.** Un punto de color en los días con plan,
   distinto del sombreado de cumplimiento, para que no se confundan.
4. **Detalle del plan.** Quién aceptó, quién falta, botón de cancelar
   para el dueño y de salirse para los invitados.
5. **Recordatorio.** Aviso el día del plan. Con la app abierta ya
   funciona; con el teléfono bloqueado necesita la etapa 4.

---

## Etapa 4 — Avisos reales (proyecto aparte)

Para que suene con el teléfono bloqueado hacen falta tres cosas:
permiso de notificación en la PWA instalada, suscripción Web Push
guardada en Supabase, y una Edge Function con cron que revise cada
quince minutos qué planes están por empezar y dispare el aviso.

En iOS solo funciona si la app está instalada desde Safari con
*Añadir a pantalla de inicio*. En una pestaña normal no hay push.

---

## Decisiones ya tomadas

- Los planes no entran a `D.tareas`. Se proyectan, no se copian.
- Un plan cancelado se conserva con estado `cancelado`, no se borra.
  Sirve para saber por qué desapareció algo del calendario.
- No hay chat. Si hace falta discutir, es WhatsApp. Meter mensajería
  aquí duplica algo que ya funciona mejor en otro lado.
- Sin roles ni permisos finos. Hay dueño e invitados, y ya.

## Riesgos a vigilar

- **Bucles de sincronización.** Si aceptar un plan dispara una subida
  que dispara una bajada, se cicla. Marcar el origen del cambio.
- **Relojes desfasados.** Dos teléfonos con hora distinta rompen el
  desempate por fecha. Usar `now()` del servidor, no del navegador.
- **Correos con mayúsculas.** Normalizar siempre a minúsculas antes de
  comparar, o Ana@ y ana@ serán dos personas distintas.
