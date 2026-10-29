from django.contrib import admin

from .models import Booking, Campaign, Contact, Conversation, Message, QuickReply, Service, Staff, Template, WhatsAppConfig, Workspace


@admin.register(Workspace)
class WorkspaceAdmin(admin.ModelAdmin):
    list_display = ("name", "industry", "phone", "timezone")


@admin.register(WhatsAppConfig)
class WhatsAppConfigAdmin(admin.ModelAdmin):
    list_display = ("workspace", "phone_number_id", "display_phone", "connected")


@admin.register(Staff)
class StaffAdmin(admin.ModelAdmin):
    list_display = ("name", "role", "workspace", "user", "is_agent", "active")


@admin.register(Contact)
class ContactAdmin(admin.ModelAdmin):
    list_display = ("name", "phone", "opt_in", "workspace", "created_at")
    search_fields = ("name", "phone", "email")
    list_filter = ("opt_in",)


@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    list_display = ("contact", "service", "staff", "start", "status", "reminder")
    list_filter = ("status", "reminder", "source")


class MessageInline(admin.TabularInline):
    model = Message
    extra = 0
    fields = ("created_at", "direction", "author", "kind", "body", "status")
    readonly_fields = fields


@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    list_display = ("contact", "status", "assignee", "unread", "last_inbound_at")
    inlines = [MessageInline]


@admin.register(Template)
class TemplateAdmin(admin.ModelAdmin):
    list_display = ("name", "category", "language", "status")
    list_editable = ("status",)


admin.site.register(Service)
admin.site.register(Campaign)
admin.site.register(QuickReply)
