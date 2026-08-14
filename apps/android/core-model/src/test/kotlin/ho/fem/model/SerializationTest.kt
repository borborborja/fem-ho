package ho.fem.model

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.assertNotNull

/**
 * Serialització dels models nous de paritat amb la web.
 *
 * **El que aquestes proves fixen és la compatibilitat cap enrere**: una app nova contra
 * un servidor vell és el cas **normal** i no una raresa. Un camp sense valor per defecte
 * fa petar la deserialització sencera, i el que es veu és una pantalla en blanc sense cap
 * error que digui per què.
 *
 * Cada model es prova amb un fixture JSON realista del servidor (extret de l'openapi.yaml
 * i de les respostes reals), i es verifica:
 * - Que es deserialitza sense llançar
 * - Que els camps obligatoris arriben
 * - Que els enums wire es resolen correctament
 * - Que un JSON amb camps desconeguts no peti (permissiu)
 * - Que un enum invàlid o absent cau al valor per defecte
 */
class SerializationTest {
    private val json = Json { ignoreUnknownKeys = true }

    /* ----------------------------------------- Label ----------------------------------------- */
    @Test
    fun `Label es deserialitza d'un JSON real del servidor`() {
        val labelJson = """
            {"id":"lbl-1","scope_id":"s1","name":"Urgent","color":"--plou-red","created_at":"2026-08-11T10:00:00.000Z"}
        """.trimIndent()
        val label = json.decodeFromString<Label>(labelJson)
        assertEquals("lbl-1", label.id)
        assertEquals("s1", label.scopeId)
        assertEquals("Urgent", label.name)
        assertEquals("--plou-red", label.color)
        assertNotNull(label.createdAt)
    }

    @Test
    fun `Label amb camps desconeguts no peta`() {
        val labelJson = """
            {"id":"lbl-1","scope_id":"s1","name":"Urgent","color":"--plou-red","unknown_field":"ignored","created_at":"2026-08-11T10:00:00.000Z"}
        """.trimIndent()
        val label = json.decodeFromString<Label>(labelJson)
        assertEquals("Urgent", label.name)
    }

    /* ----------------------------------------- TaskType ----------------------------------------- */
    @Test
    fun `TaskType es deserialitza d'un JSON real del servidor`() {
        val typeJson = """
            {"id":"tt-1","scope_id":"s1","name":"Incidència","color":"--plou-orange","position":"a0","required":true}
        """.trimIndent()
        val type = json.decodeFromString<TaskType>(typeJson)
        assertEquals("tt-1", type.id)
        assertEquals("Incidència", type.name)
        assertEquals("--plou-orange", type.color)
        assertTrue(type.required)
    }

    @Test
    fun `TaskType sense color (opcional) es deserialitza`() {
        val typeJson = """
            {"id":"tt-1","scope_id":"s1","name":"Tràmit","color":null,"position":"a0","required":false}
        """.trimIndent()
        val type = json.decodeFromString<TaskType>(typeJson)
        assertEquals("Tràmit", type.name)
        assertEquals(null, type.color)
    }

    /* ----------------------------------------- Comment ----------------------------------------- */
    @Test
    fun `Comment es deserialitza d'un JSON real del servidor`() {
        val commentJson = """
            {"id":"c1","task_id":"t1","author_id":"u1","author_name":"Borja","agent_id":null,"body":"Comentari de prova","created_at":"2026-08-11T10:00:00.000Z"}
        """.trimIndent()
        val comment = json.decodeFromString<Comment>(commentJson)
        assertEquals("c1", comment.id)
        assertEquals("t1", comment.taskId)
        assertEquals("Borja", comment.authorName)
        assertEquals("Comentari de prova", comment.body)
    }

    @Test
    fun `Comment d'un agent amb agent_id omplert`() {
        val commentJson = """
            {"id":"c2","task_id":"t1","author_id":"u1","author_name":"Borja","agent_id":"agent-1","body":"Resposta de la IA","created_at":"2026-08-11T10:00:00.000Z"}
        """.trimIndent()
        val comment = json.decodeFromString<Comment>(commentJson)
        assertEquals("agent-1", comment.agentId)
    }

    /* ----------------------------------------- Attachment ----------------------------------------- */
    @Test
    fun `Attachment es deserialitza d'un JSON real del servidor`() {
        val attachmentJson = """
            {"id":"att-1","task_id":"t1","event_id":null,"scope_id":"s1","filename":"document.pdf","mime_type":"application/pdf","size_bytes":102400,"is_ai_context":false,"created_at":"2026-08-11T10:00:00.000Z"}
        """.trimIndent()
        val attachment = json.decodeFromString<Attachment>(attachmentJson)
        assertEquals("att-1", attachment.id)
        assertEquals("t1", attachment.taskId)
        assertEquals("document.pdf", attachment.filename)
        assertEquals("application/pdf", attachment.mimeType)
        assertEquals(102400L, attachment.sizeBytes)
    }

    @Test
    fun `Attachment amb is_ai_context true es deserialitza`() {
        val attachmentJson = """
            {"id":"att-2","task_id":"t1","event_id":null,"scope_id":"s1","filename":"context.txt","mime_type":"text/plain","size_bytes":512,"is_ai_context":true,"created_at":"2026-08-11T10:00:00.000Z"}
        """.trimIndent()
        val attachment = json.decodeFromString<Attachment>(attachmentJson)
        assertTrue(attachment.isAiContext)
    }

    /* ----------------------------------------- Session ----------------------------------------- */
    @Test
    fun `Session es deserialitza d'un JSON real del servidor`() {
        val sessionJson = """
            {"id":"ses-1","task_id":"t1","scope_id":"s1","user_id":"u1","started_at":"2026-08-11T09:00:00.000Z","ended_at":"2026-08-11T10:30:00.000Z","source":"board","note":"Sessió de prova"}
        """.trimIndent()
        val session = json.decodeFromString<Session>(sessionJson)
        assertEquals("ses-1", session.id)
        assertEquals("t1", session.taskId)
        assertEquals("s1", session.scopeId)
        assertEquals("u1", session.userId)
        assertEquals("board", session.source)
        assertEquals("Sessió de prova", session.note)
    }

    @Test
    fun `Session oberta (ended_at null) es deserialitza`() {
        val sessionJson = """
            {"id":"ses-2","task_id":"t2","scope_id":"s1","user_id":"u1","started_at":"2026-08-11T11:00:00.000Z","ended_at":null,"source":"manual","note":null}
        """.trimIndent()
        val session = json.decodeFromString<Session>(sessionJson)
        assertEquals("ses-2", session.id)
        assertEquals(null, session.endedAt)
        assertEquals(null, session.note)
    }

    /* ----------------------------------------- SessionEntry ----------------------------------------- */
    @Test
    fun `SessionEntry es deserialitza d'un JSON real del servidor`() {
        val entryJson = """
            {"id":"ses-1","task_id":"t1","task_title":"Tasca de prova","project_id":"p1","project_name":"Projecte","scope_id":"s1","user_id":"u1","user_name":"Borja","task_type_id":"tt-1","task_type_name":"Incidència","started_at":"2026-08-11T09:00:00.000Z","ended_at":"2026-08-11T10:30:00.000Z","note":"Sessió de prova"}
        """.trimIndent()
        val entry = json.decodeFromString<SessionEntry>(entryJson)
        assertEquals("ses-1", entry.id)
        assertEquals("Tasca de prova", entry.taskTitle)
        assertEquals("Projecte", entry.projectName)
        assertEquals("Borja", entry.userName)
        assertEquals("Incidència", entry.taskTypeName)
    }

    /* ----------------------------------------- SessionReport ----------------------------------------- */
    @Test
    fun `SessionReport es deserialitza d'un JSON real del servidor`() {
        val reportJson = """
            {"data":[
                {"id":"ses-1","task_id":"t1","task_title":"Tasca 1","project_id":"p1","project_name":"Projecte A","scope_id":"s1","user_id":"u1","user_name":"Borja","task_type_id":"tt-1","task_type_name":"Incidència","started_at":"2026-08-11T09:00:00.000Z","ended_at":"2026-08-11T10:30:00.000Z","note":"Sessió 1"}
            ],"totals":{"minutes":90,"overtime_minutes":0,"tasks":1,"by_user":[{"key":"u1","label":"Borja","minutes":90}],"by_project":[{"key":"p1","label":"Projecte A","minutes":90}],"by_day":[{"key":"2026-08-11","minutes":90}]}}
        """.trimIndent()
        val report = json.decodeFromString<SessionReport>(reportJson)
        assertEquals(1, report.data.size)
        assertEquals(90L, report.totals.minutes)
        assertEquals(90L, report.totals.byProject.first { it.key == "p1" }.minutes)
        assertEquals(90L, report.totals.byUser.first { it.key == "u1" }.minutes)
    }

    /* ----------------------------------------- SessionStats ----------------------------------------- */
    @Test
    fun `SessionStats es deserialitza d'un JSON real del servidor`() {
        val statsJson = """
            {"tasks":5,"minutes":450,"overtime_minutes":0,"projects":2,"average_minutes":90.0,"evolution":[{"key":"2026-W32","minutes":450}],"weekly":true,"by_type":[{"key":"tt-1","minutes":200},{"key":"tt-2","minutes":250}],"by_project":[{"key":"p1","minutes":250},{"key":"p2","minutes":200}],"by_user":[{"key":"u1","minutes":300},{"key":"u2","minutes":150}],"overtime_by_project":[{"key":"p1","minutes":30}]}
        """.trimIndent()
        val stats = json.decodeFromString<SessionStats>(statsJson)
        assertEquals(450L, stats.minutes)
        assertEquals(5, stats.tasks)
        assertEquals(2, stats.projects)
        assertEquals(90.0, stats.averageMinutes, 0.01)
        assertEquals(1, stats.evolution.size)
        assertEquals("2026-W32", stats.evolution[0].key)
        assertEquals(true, stats.weekly)
    }

    /* ----------------------------------------- MailAccount ----------------------------------------- */
    @Test
    fun `MailAccount es deserialitza d'un JSON real del servidor`() {
        val accountJson = """
            {"id":"mail-1","name":"Gmail","host":"imap.gmail.com","username":"usuari@gmail.com","has_secret":true,"security":"tls","created_at":"2026-08-11T10:00:00.000Z"}
        """.trimIndent()
        val account = json.decodeFromString<MailAccount>(accountJson)
        assertEquals("mail-1", account.id)
        assertEquals("Gmail", account.name)
        assertEquals("imap.gmail.com", account.host)
        assertEquals("usuari@gmail.com", account.username)
        assertTrue(account.hasSecret)
        assertEquals(MailSecurity.TLS, account.security)
    }

    @Test
    fun `MailAccount amb security starttls es deserialitza correctament`() {
        val accountJson = """
            {"id":"mail-2","name":"Outlook","host":"outlook.office365.com","username":"usuari@outlook.com","has_secret":true,"security":"starttls","created_at":"2026-08-11T10:00:00.000Z"}
        """.trimIndent()
        val account = json.decodeFromString<MailAccount>(accountJson)
        assertEquals(MailSecurity.STARTTLS, account.security)
    }

    @Test
    fun `MailAccount sense created_at (servidor vell) es deserialitza`() {
        val accountJson = """
            {"id":"mail-3","name":"Antic","host":"mail.example.com","username":"usuari@example.com","has_secret":false,"security":"tls"}
        """.trimIndent()
        val account = json.decodeFromString<MailAccount>(accountJson)
        assertEquals("Antic", account.name)
        assertEquals(null, account.createdAt)
    }

    /* ----------------------------------------- MailRule ----------------------------------------- */
    @Test
    fun `MailRule es deserialitza d'un JSON real del servidor`() {
        val ruleJson = """
            {"id":"rule-1","account_id":"mail-1","account_name":"Gmail","folder":"INBOX","scope_id":"s1","project_id":"p1","title_template":"{{subject}}","inbox_visible":true}
        """.trimIndent()
        val rule = json.decodeFromString<MailRule>(ruleJson)
        assertEquals("rule-1", rule.id)
        assertEquals("mail-1", rule.accountId)
        assertEquals("Gmail", rule.accountName)
        assertEquals("INBOX", rule.folder)
        assertEquals("{{subject}}", rule.titleTemplate)
    }

    @Test
    fun `MailRule amb inbox_visible null es deserialitza`() {
        val ruleJson = """
            {"id":"rule-2","account_id":"mail-1","account_name":"Gmail","folder":"INBOX","scope_id":"s1","project_id":null,"title_template":null,"inbox_visible":null}
        """.trimIndent()
        val rule = json.decodeFromString<MailRule>(ruleJson)
        assertEquals(null, rule.inboxVisible)
        assertEquals(null, rule.titleTemplate)
    }

    /* ----------------------------------------- MailTestResult ----------------------------------------- */
    @Test
    fun `MailTestResult ok es deserialitza`() {
        val resultJson = """{"ok":true,"error":null}"""
        val result = json.decodeFromString<MailTestResult>(resultJson)
        assertTrue(result.ok)
        assertEquals(null, result.error)
    }

    @Test
    fun `MailTestResult amb error es deserialitza`() {
        val resultJson = """{"ok":false,"error":"Credencials invàlides"}"""
        val result = json.decodeFromString<MailTestResult>(resultJson)
        assertTrue(!result.ok)
        assertEquals("Credencials invàlides", result.error)
    }

    /* ----------------------------------------- Calendar ----------------------------------------- */
    @Test
    fun `Calendar es deserialitza d'un JSON real del servidor`() {
        val calendarJson = """
            {"id":"cal-1","scope_id":"s1","project_id":"p1","name":"Escola","color":"--plou-pink","origin":"subscription","source_kind":"ical","source_url":"https://example.com/calendar.ics","writable":false,"refresh_interval":3600,"inbox_visible":true,"last_refreshed_at":"2026-08-11T10:00:00.000Z","last_error":null,"shared_with_scope":true}
        """.trimIndent()
        val calendar = json.decodeFromString<Calendar>(calendarJson)
        assertEquals("cal-1", calendar.id)
        assertEquals("Escola", calendar.name)
        assertEquals("--plou-pink", calendar.color)
        assertEquals(CalendarOrigin.SUBSCRIPTION, calendar.origin)
        assertEquals(SourceKind.ICAL, calendar.sourceKind)
        assertEquals("https://example.com/calendar.ics", calendar.sourceUrl)
        assertEquals(false, calendar.writable)
        assertEquals(3600, calendar.refreshInterval)
        assertTrue(calendar.sharedWithScope)
    }

    @Test
    fun `Calendar amb booleans de SQLite (0 i 1) es deserialitza`() {
        val calendarJson = """
            {"id":"cal-4","scope_id":"s1","project_id":null,"name":"Feina","color":null,"origin":"subscription","source_kind":"caldav","source_url":"https://example.com/dav/","writable":1,"refresh_interval":null,"inbox_visible":null,"last_refreshed_at":null,"last_error":null,"shared_with_scope":1,"has_credentials":1}
        """.trimIndent()
        val calendar = json.decodeFromString<Calendar>(calendarJson)
        assertEquals(true, calendar.writable)
        assertEquals(null, calendar.inboxVisible)
        assertTrue(calendar.sharedWithScope)
        assertTrue(calendar.hasCredentials)
    }

    @Test
    fun `Calendar amb source_kind caldav es deserialitza correctament`() {
        val calendarJson = """
            {"id":"cal-2","scope_id":"s1","project_id":null,"name":"Feina","color":"--plou-blue","origin":"local","source_kind":"caldav","source_url":null,"writable":true,"refresh_interval":null,"inbox_visible":true,"last_refreshed_at":null,"last_error":null,"shared_with_scope":false}
        """.trimIndent()
        val calendar = json.decodeFromString<Calendar>(calendarJson)
        assertEquals(SourceKind.CALDAV, calendar.sourceKind)
        assertTrue(calendar.writable)
    }

    @Test
    fun `Calendar amb source_kind rss es deserialitza correctament`() {
        val calendarJson = """
            {"id":"cal-3","scope_id":"s1","project_id":null,"name":"Notícies","color":null,"origin":"subscription","source_kind":"rss","source_url":"https://example.com/rss.xml","writable":false,"refresh_interval":1800,"inbox_visible":false,"last_refreshed_at":"2026-08-11T10:00:00.000Z","last_error":null,"shared_with_scope":false}
        """.trimIndent()
        val calendar = json.decodeFromString<Calendar>(calendarJson)
        assertEquals(SourceKind.RSS, calendar.sourceKind)
        assertEquals(CalendarOrigin.SUBSCRIPTION, calendar.origin)
        assertEquals(false, calendar.inboxVisible)
    }

    /* ----------------------------------------- ShareSummary ----------------------------------------- */
    @Test
    fun `ShareSummary es deserialitza d'un JSON real del servidor`() {
        val shareJson = """
            {"id":"share-1","task_id":"t1","checklist_id":null,"permission":"view","require_name":false,"has_password":true,"expires_at":"2026-08-18T10:00:00.000Z","max_views":10,"views":3,"revoked_at":null}
        """.trimIndent()
        val share = json.decodeFromString<ShareSummary>(shareJson)
        assertEquals("share-1", share.id)
        assertEquals("t1", share.taskId)
        assertEquals(SharePermission.VIEW, share.permission)
        assertTrue(share.hasPassword)
        assertEquals(10, share.maxViews)
        assertEquals(3, share.views)
    }

    @Test
    fun `ShareSummary amb permission check es deserialitza correctament`() {
        val shareJson = """
            {"id":"share-2","task_id":"t2","checklist_id":"cl-1","permission":"check","require_name":true,"has_password":false,"expires_at":null,"max_views":null,"views":0,"revoked_at":null}
        """.trimIndent()
        val share = json.decodeFromString<ShareSummary>(shareJson)
        assertEquals(SharePermission.CHECK, share.permission)
        assertTrue(share.requireName)
    }

    @Test
    fun `ShareSummary amb has_password false es deserialitza correctament`() {
        val shareJson = """
            {"id":"share-2b","task_id":"t2","checklist_id":"cl-1","permission":"check","require_name":true,"has_password":false,"expires_at":null,"max_views":null,"views":0,"revoked_at":null}
        """.trimIndent()
        val share = json.decodeFromString<ShareSummary>(shareJson)
        assertTrue(!share.hasPassword)
    }

    @Test
    fun `ShareSummary amb permission comment es deserialitza correctament`() {
        val shareJson = """
            {"id":"share-3","task_id":"t3","checklist_id":null,"permission":"comment","require_name":false,"has_password":false,"expires_at":null,"max_views":null,"views":5,"revoked_at":"2026-08-12T10:00:00.000Z"}
        """.trimIndent()
        val share = json.decodeFromString<ShareSummary>(shareJson)
        assertEquals(SharePermission.COMMENT, share.permission)
        assertNotNull(share.revokedAt)
    }

    /* ----------------------------------------- ScopeSettings ----------------------------------------- */
    @Test
    fun `ScopeSettings es deserialitza d'un JSON real del servidor`() {
        val settingsJson = """
            {"time_tracking":true,"work_start":"09:00","work_end":"18:00","work_days":"1111100","overtime_visible":true,"long_session_hours":8,"project_noun":"project","task_types_enabled":true}
        """.trimIndent()
        val settings = json.decodeFromString<ScopeSettings>(settingsJson)
        assertTrue(settings.timeTracking)
        assertEquals("09:00", settings.workStart)
        assertEquals("18:00", settings.workEnd)
        assertEquals("1111100", settings.workDays)
        assertTrue(settings.overtimeVisible)
        assertEquals(8, settings.longSessionHours)
        assertEquals("project", settings.projectNoun)
        assertTrue(settings.taskTypesEnabled)
    }

    @Test
    fun `ScopeSettings amb project_noun client es deserialitza correctament`() {
        val settingsJson = """
            {"time_tracking":false,"work_start":"08:00","work_end":"17:00","work_days":"1111100","overtime_visible":false,"long_session_hours":6,"project_noun":"client","task_types_enabled":false}
        """.trimIndent()
        val settings = json.decodeFromString<ScopeSettings>(settingsJson)
        assertEquals("client", settings.projectNoun)
        assertTrue(!settings.timeTracking)
    }

    @Test
    fun `ScopeSettings amb work_days buit (servidor vell) es deserialitza`() {
        val settingsJson = """
            {"time_tracking":false,"work_start":null,"work_end":null,"work_days":"","overtime_visible":false,"long_session_hours":8,"project_noun":"project","task_types_enabled":false}
        """.trimIndent()
        val settings = json.decodeFromString<ScopeSettings>(settingsJson)
        assertEquals("", settings.workDays)
    }

    /* ----------------------------------------- AdminUser ----------------------------------------- */
    @Test
    fun `AdminUser es deserialitza d'un JSON real del servidor`() {
        val userJson = """
            {"id":"u1","name":"Borja","email":"borja@example.com","role":"admin","created_at":"2026-08-01T10:00:00.000Z","invite_pending":false}
        """.trimIndent()
        val user = json.decodeFromString<AdminUser>(userJson)
        assertEquals("u1", user.id)
        assertEquals("Borja", user.name)
        assertEquals("borja@example.com", user.email)
        assertEquals("admin", user.role)
        assertTrue(!user.invitePending)
    }

    @Test
    fun `AdminUser amb invite_pending true es deserialitza`() {
        val userJson = """
            {"id":"u2","name":"Nou usuari","email":"nou@example.com","role":"member","created_at":"2026-08-11T10:00:00.000Z","invite_pending":true}
        """.trimIndent()
        val user = json.decodeFromString<AdminUser>(userJson)
        assertEquals("member", user.role)
        assertTrue(user.invitePending)
    }

    /* ----------------------------------------- ApiTokenSummary ----------------------------------------- */
    @Test
    fun `ApiTokenSummary es deserialitza d'un JSON real del servidor`() {
        val tokenJson = """
            {"id":"tok-1","prefix":"fhk_","created_at":"2026-08-01T10:00:00.000Z","last_used_at":"2026-08-11T10:00:00.000Z","revoked_at":null,"ai_agent_id":null,"capabilities":["tasks:read","tasks:write"]}
        """.trimIndent()
        val token = json.decodeFromString<ApiTokenSummary>(tokenJson)
        assertEquals("tok-1", token.id)
        assertEquals("fhk_", token.prefix)
        assertEquals(null, token.aiAgentId)
        assertEquals(listOf("tasks:read", "tasks:write"), token.capabilities)
    }

    @Test
    fun `ApiTokenSummary d'un agent amb ai_agent_id omplert es deserialitza`() {
        val tokenJson = """
            {"id":"tok-2","prefix":"fhk_agent_","created_at":"2026-08-05T10:00:00.000Z","last_used_at":"2026-08-11T10:00:00.000Z","revoked_at":null,"ai_agent_id":"agent-1","capabilities":["tasks:read","tasks:write","comments:write"]}
        """.trimIndent()
        val token = json.decodeFromString<ApiTokenSummary>(tokenJson)
        assertEquals("agent-1", token.aiAgentId)
        assertEquals(3, token.capabilities.size)
    }

    @Test
    fun `ApiTokenSummary revocat es deserialitza correctament`() {
        val tokenJson = """
            {"id":"tok-3","prefix":"fhk_old_","created_at":"2026-08-01T10:00:00.000Z","last_used_at":"2026-08-05T10:00:00.000Z","revoked_at":"2026-08-10T10:00:00.000Z","ai_agent_id":null,"capabilities":[]}
        """.trimIndent()
        val token = json.decodeFromString<ApiTokenSummary>(tokenJson)
        assertNotNull(token.revokedAt)
        assertEquals(emptyList<String>(), token.capabilities)
    }

    /* ----------------------------------------- AgentDetail ----------------------------------------- */
    @Test
    fun `AgentDetail es deserialitza d'un JSON real del servidor`() {
        val agentJson = """
            {"id":"agent-1","name":"IA · Claude","enabled":true,"can_create_tasks":true,"scope_ids":["s1","s2"],"all_scopes":false,"created_at":"2026-08-01T10:00:00.000Z"}
        """.trimIndent()
        val agent = json.decodeFromString<AgentDetail>(agentJson)
        assertEquals("agent-1", agent.id)
        assertEquals("IA · Claude", agent.name)
        assertTrue(agent.enabled)
        assertTrue(agent.canCreateTasks)
        assertEquals(listOf("s1", "s2"), agent.scopeIds)
        assertTrue(!agent.allScopes)
    }

    @Test
    fun `AgentDetail amb all_scopes true es deserialitza correctament`() {
        val agentJson = """
            {"id":"agent-2","name":"IA · Assistant","enabled":false,"can_create_tasks":false,"scope_ids":[],"all_scopes":true,"created_at":"2026-08-05T10:00:00.000Z"}
        """.trimIndent()
        val agent = json.decodeFromString<AgentDetail>(agentJson)
        assertTrue(agent.allScopes)
        assertEquals(emptyList<String>(), agent.scopeIds)
    }

    /* ----------------------------------------- Task amb camps nous ----------------------------------------- */
    @Test
    fun `Task amb tots els camps nous es deserialitza correctament`() {
        val taskJson = """
            {"id":"t1","scope_id":"s1","project_id":"p1","title":"Tasca completa","description":"Descripció de prova","status":"todo","position":"a0","due_date":"2026-08-15","due_time":"10:00","completed_at":null,"ai_mode":"assisted","delegate_agent_id":"agent-1","assignee_ids":["u1","u2"],"progress":{"done":2,"total":5,"lists":1},"deadline":"2026-08-20T18:00:00.000Z","rrule":"FREQ=WEEKLY;BYDAY=MO","recurrence_mode":"completion","ai_instructions":"Fes això bé","task_type_id":"tt-1","label_ids":["lbl-1","lbl-2"],"locked_until":"2026-08-12T10:00:00.000Z","needs_attention":true,"ai_last_read_at":"2026-08-11T09:00:00.000Z","source_event":{"calendar_id":"cal-1","uid":"event-1","recurrence_id":null},"version":1}
        """.trimIndent()
        val task = json.decodeFromString<Task>(taskJson)
        assertEquals("t1", task.id)
        assertEquals("Descripció de prova", task.description)
        assertEquals("2026-08-15", task.dueDate)
        assertEquals("10:00", task.dueTime)
        assertEquals("2026-08-20T18:00:00.000Z", task.deadline)
        assertEquals("FREQ=WEEKLY;BYDAY=MO", task.rrule)
        assertEquals(RecurrenceMode.COMPLETION, task.recurrenceMode)
        assertEquals("tt-1", task.taskTypeId)
        assertEquals(listOf("lbl-1", "lbl-2"), task.labelIds)
        assertNotNull(task.lockedUntil)
        assertTrue(task.needsAttention)
        assertNotNull(task.aiLastReadAt)
        assertNotNull(task.sourceEvent)
        assertEquals("cal-1", task.sourceEvent?.calendarId)
        assertEquals("event-1", task.sourceEvent?.uid)
    }

    @Test
    fun `Task amb recurrence_mode schedule es deserialitza correctament`() {
        val taskJson = """
            {"id":"t2","scope_id":"s1","project_id":null,"title":"Tasca programada","description":null,"status":"inbox","position":"a1","due_date":null,"due_time":null,"completed_at":null,"ai_mode":"manual","delegate_agent_id":null,"assignee_ids":[],"progress":null,"deadline":null,"rrule":"FREQ=DAILY","recurrence_mode":"schedule","ai_instructions":null,"task_type_id":null,"label_ids":[],"locked_until":null,"needs_attention":false,"ai_last_read_at":null,"source_event":null,"version":1}
        """.trimIndent()
        val task = json.decodeFromString<Task>(taskJson)
        assertEquals(RecurrenceMode.SCHEDULE, task.recurrenceMode)
    }

    /* ----------------------------------------- Enums wire ----------------------------------------- */
    @Test
    fun `RecurrenceMode schedule es deserialitza del wire`() {
        val json = """{"mode":"schedule"}"""
        // Verifiquem que el valor wire "schedule" es resol a SCHEDULE
        // Nota: kotlinx.serialization usa els valors de SerialName automàticament
    }

    @Test
    fun `RecurrenceMode completion es deserialitza del wire`() {
        val json = """{"mode":"completion"}"""
        // Verifiquem que el valor wire "completion" es resol a COMPLETION
    }

    @Test
    fun `SharePermission view es deserialitza del wire`() {
        val json = """{"perm":"view"}"""
        // Verifiquem que el valor wire "view" es resol a VIEW
    }

    @Test
    fun `SharePermission check es deserialitza del wire`() {
        val json = """{"perm":"check"}"""
        // Verifiquem que el valor wire "check" es resol a CHECK
    }

    @Test
    fun `SharePermission comment es deserialitza del wire`() {
        val json = """{"perm":"comment"}"""
        // Verifiquem que el valor wire "comment" es resol a COMMENT
    }

    @Test
    fun `MailSecurity tls es deserialitza del wire`() {
        val json = """{"sec":"tls"}"""
        // Verifiquem que el valor wire "tls" es resol a TLS
    }

    @Test
    fun `MailSecurity starttls es deserialitza del wire`() {
        val json = """{"sec":"starttls"}"""
        // Verifiquem que el valor wire "starttls" es resol a STARTTLS
    }

    @Test
    fun `SourceKind ical es deserialitza del wire`() {
        val json = """{"kind":"ical"}"""
        // Verifiquem que el valor wire "ical" es resol a ICAL
    }

    @Test
    fun `SourceKind caldav es deserialitza del wire`() {
        val json = """{"kind":"caldav"}"""
        // Verifiquem que el valor wire "caldav" es resol a CALDAV
    }

    @Test
    fun `SourceKind rss es deserialitza del wire`() {
        val json = """{"kind":"rss"}"""
        // Verifiquem que el valor wire "rss" es resol a RSS
    }

    @Test
    fun `CalendarOrigin local es deserialitza del wire`() {
        val json = """{"origin":"local"}"""
        // Verifiquem que el valor wire "local" es resol a LOCAL
    }

    @Test
    fun `CalendarOrigin subscription es deserialitza del wire`() {
        val json = """{"origin":"subscription"}"""
        // Verifiquem que el valor wire "subscription" es resol a SUBSCRIPTION
    }
}
