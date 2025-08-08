#!/bin/bash

# مراقب Debug Logs لنظام الدردشة
# هذا السكريبت يساعد في مراقبة وتصفية اللوجات الجديدة

LOG_FILE="app.log"
COLOR_RED='\033[0;31m'
COLOR_GREEN='\033[0;32m'
COLOR_YELLOW='\033[1;33m'
COLOR_BLUE='\033[0;34m'
COLOR_PURPLE='\033[0;35m'
COLOR_CYAN='\033[0;36m'
COLOR_NC='\033[0m' # No Color

echo -e "${COLOR_CYAN}🔍 مراقب Debug Logs لنظام الدردشة${COLOR_NC}"
echo -e "${COLOR_CYAN}======================================${COLOR_NC}"

show_help() {
    echo "الاستخدام: ./monitor_debug_logs.sh [خيار]"
    echo ""
    echo "الخيارات المتاحة:"
    echo "  all          - عرض جميع لوجات الدردشة"
    echo "  chat         - لوجات ChatService فقط"
    echo "  captain      - لوجات CaptainSocket فقط"
    echo "  customer     - لوجات CustomerSocket فقط"
    echo "  errors       - الأخطاء فقط"
    echo "  performance  - قياسات الأداء فقط"
    echo "  debug        - Debug logs فقط"
    echo "  live         - مراقبة مباشرة"
    echo "  help         - عرض هذه التعليمات"
    echo ""
    echo "أمثلة:"
    echo "  ./monitor_debug_logs.sh all"
    echo "  ./monitor_debug_logs.sh live"
    echo "  ./monitor_debug_logs.sh errors"
}

# التحقق من وجود ملف اللوجات
check_log_file() {
    if [ ! -f "$LOG_FILE" ]; then
        echo -e "${COLOR_RED}❌ ملف اللوجات غير موجود: $LOG_FILE${COLOR_NC}"
        echo -e "${COLOR_YELLOW}💡 تأكد من تشغيل الخادم أولاً${COLOR_NC}"
        exit 1
    fi
}

# عرض جميع لوجات الدردشة
show_all_chat_logs() {
    echo -e "${COLOR_GREEN}📋 عرض جميع لوجات الدردشة...${COLOR_NC}"
    cat "$LOG_FILE" | grep -E "\[ChatService\]|\[CaptainSocket\]|\[CustomerSocket\]" | while IFS= read -r line; do
        if [[ $line == *"ERROR"* ]]; then
            echo -e "${COLOR_RED}$line${COLOR_NC}"
        elif [[ $line == *"WARN"* ]]; then
            echo -e "${COLOR_YELLOW}$line${COLOR_NC}"
        elif [[ $line == *"INFO"* ]]; then
            echo -e "${COLOR_GREEN}$line${COLOR_NC}"
        elif [[ $line == *"DEBUG"* ]]; then
            echo -e "${COLOR_BLUE}$line${COLOR_NC}"
        else
            echo "$line"
        fi
    done
}

# عرض لوجات ChatService فقط
show_chat_service_logs() {
    echo -e "${COLOR_GREEN}💬 عرض لوجات ChatService...${COLOR_NC}"
    cat "$LOG_FILE" | grep "\[ChatService\]" | while IFS= read -r line; do
        if [[ $line == *"ERROR"* ]]; then
            echo -e "${COLOR_RED}$line${COLOR_NC}"
        elif [[ $line == *"WARN"* ]]; then
            echo -e "${COLOR_YELLOW}$line${COLOR_NC}"
        else
            echo -e "${COLOR_CYAN}$line${COLOR_NC}"
        fi
    done
}

# عرض لوجات Captain Socket فقط
show_captain_logs() {
    echo -e "${COLOR_GREEN}👨‍✈️ عرض لوجات Captain Socket...${COLOR_NC}"
    cat "$LOG_FILE" | grep "\[CaptainSocket\]" | while IFS= read -r line; do
        if [[ $line == *"ERROR"* ]]; then
            echo -e "${COLOR_RED}$line${COLOR_NC}"
        elif [[ $line == *"WARN"* ]]; then
            echo -e "${COLOR_YELLOW}$line${COLOR_NC}"
        else
            echo -e "${COLOR_PURPLE}$line${COLOR_NC}"
        fi
    done
}

# عرض لوجات Customer Socket فقط
show_customer_logs() {
    echo -e "${COLOR_GREEN}👤 عرض لوجات Customer Socket...${COLOR_NC}"
    cat "$LOG_FILE" | grep "\[CustomerSocket\]" | while IFS= read -r line; do
        if [[ $line == *"ERROR"* ]]; then
            echo -e "${COLOR_RED}$line${COLOR_NC}"
        elif [[ $line == *"WARN"* ]]; then
            echo -e "${COLOR_YELLOW}$line${COLOR_NC}"
        else
            echo -e "${COLOR_BLUE}$line${COLOR_NC}"
        fi
    done
}

# عرض الأخطاء فقط
show_errors() {
    echo -e "${COLOR_RED}❌ عرض الأخطاء فقط...${COLOR_NC}"
    cat "$LOG_FILE" | grep -E "\[ChatService\]|\[CaptainSocket\]|\[CustomerSocket\]" | grep "ERROR" | while IFS= read -r line; do
        echo -e "${COLOR_RED}$line${COLOR_NC}"
    done
}

# عرض قياسات الأداء
show_performance() {
    echo -e "${COLOR_GREEN}⚡ عرض قياسات الأداء...${COLOR_NC}"
    cat "$LOG_FILE" | grep -E "processingTime|totalTime" | while IFS= read -r line; do
        if [[ $line == *"ERROR"* ]]; then
            echo -e "${COLOR_RED}$line${COLOR_NC}"
        else
            echo -e "${COLOR_GREEN}$line${COLOR_NC}"
        fi
    done
}

# عرض Debug logs فقط
show_debug() {
    echo -e "${COLOR_BLUE}🔍 عرض Debug logs فقط...${COLOR_NC}"
    cat "$LOG_FILE" | grep -E "\[ChatService\]|\[CaptainSocket\]|\[CustomerSocket\]" | grep "DEBUG" | while IFS= read -r line; do
        echo -e "${COLOR_BLUE}$line${COLOR_NC}"
    done
}

# المراقبة المباشرة
live_monitoring() {
    echo -e "${COLOR_GREEN}🔴 بدء المراقبة المباشرة... (اضغط Ctrl+C للخروج)${COLOR_NC}"
    tail -f "$LOG_FILE" | grep --line-buffered -E "\[ChatService\]|\[CaptainSocket\]|\[CustomerSocket\]" | while IFS= read -r line; do
        if [[ $line == *"ERROR"* ]]; then
            echo -e "${COLOR_RED}$line${COLOR_NC}"
        elif [[ $line == *"WARN"* ]]; then
            echo -e "${COLOR_YELLOW}$line${COLOR_NC}"
        elif [[ $line == *"INFO"* ]]; then
            echo -e "${COLOR_GREEN}$line${COLOR_NC}"
        elif [[ $line == *"DEBUG"* ]]; then
            echo -e "${COLOR_BLUE}$line${COLOR_NC}"
        else
            echo "$line"
        fi
    done
}

# عرض إحصائيات سريعة
show_stats() {
    echo -e "${COLOR_CYAN}📊 إحصائيات سريعة:${COLOR_NC}"
    echo "================================"
    
    total_chat_logs=$(cat "$LOG_FILE" | grep -c -E "\[ChatService\]|\[CaptainSocket\]|\[CustomerSocket\]")
    chat_service_logs=$(cat "$LOG_FILE" | grep -c "\[ChatService\]")
    captain_logs=$(cat "$LOG_FILE" | grep -c "\[CaptainSocket\]")
    customer_logs=$(cat "$LOG_FILE" | grep -c "\[CustomerSocket\]")
    error_logs=$(cat "$LOG_FILE" | grep -c -E "\[ChatService\]|\[CaptainSocket\]|\[CustomerSocket\]" | grep -c "ERROR")
    
    echo -e "📋 إجمالي لوجات الدردشة: ${COLOR_GREEN}$total_chat_logs${COLOR_NC}"
    echo -e "💬 لوجات ChatService: ${COLOR_CYAN}$chat_service_logs${COLOR_NC}"
    echo -e "👨‍✈️ لوجات Captain: ${COLOR_PURPLE}$captain_logs${COLOR_NC}"
    echo -e "👤 لوجات Customer: ${COLOR_BLUE}$customer_logs${COLOR_NC}"
    echo -e "❌ لوجات الأخطاء: ${COLOR_RED}$error_logs${COLOR_NC}"
    echo ""
}

# التحقق من المعاملات
if [ $# -eq 0 ]; then
    show_help
    exit 0
fi

# التحقق من وجود ملف اللوجات
check_log_file

# عرض الإحصائيات في البداية
show_stats

# تنفيذ الأمر المطلوب
case "$1" in
    "all")
        show_all_chat_logs
        ;;
    "chat")
        show_chat_service_logs
        ;;
    "captain")
        show_captain_logs
        ;;
    "customer")
        show_customer_logs
        ;;
    "errors")
        show_errors
        ;;
    "performance")
        show_performance
        ;;
    "debug")
        show_debug
        ;;
    "live")
        live_monitoring
        ;;
    "help"|"-h"|"--help")
        show_help
        ;;
    *)
        echo -e "${COLOR_RED}❌ خيار غير معروف: $1${COLOR_NC}"
        echo ""
        show_help
        exit 1
        ;;
esac
