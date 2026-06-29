// northdl_host.cpp
//
// Runs in two modes:
//   1) No argument    -> normal Native Messaging Host (talks to Firefox
//                         over stdin/stdout).
//   2) "--install"    -> silently installs itself: writes
//                         northdl_path.txt + northdl_host.json and
//                         registers the key in the Windows Registry.
//
#include <windows.h>
#include <io.h>
#include <fcntl.h>
#include <iostream>
#include <fstream>
#include <string>
#include <vector>
#include <filesystem>
#include <cstdint>

static std::wstring g_logPath;

static void log(const std::string& msg)
{
    if (g_logPath.empty()) return;
    std::ofstream f(g_logPath, std::ios::app);
    if (f.is_open()) f << msg << "\n";
}

static std::string WideToUtf8(const std::wstring& ws)
{
    if (ws.empty())
        return {};

    int size = WideCharToMultiByte(
        CP_UTF8, 0, ws.c_str(), -1, nullptr, 0, nullptr, nullptr);

    if (size <= 1)
        return {};

    std::string out(size - 1, '\0');

    WideCharToMultiByte(
        CP_UTF8, 0, ws.c_str(), -1, out.data(), size, nullptr, nullptr);

    return out;
}

static std::wstring Utf8ToWide(const std::string& s)
{
    if (s.empty()) return {};
    int wlen = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0);
    if (wlen <= 0) return {};
    std::wstring out(wlen, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, &out[0], wlen);
    if (!out.empty() && out.back() == L'\0') out.pop_back();
    return out;
}

static std::wstring getExeDir()
{
    wchar_t buf[MAX_PATH] = {};
    GetModuleFileNameW(nullptr, buf, MAX_PATH);
    std::wstring path(buf);
    auto pos = path.rfind(L'\\');
    return (pos != std::wstring::npos) ? path.substr(0, pos) : path;
}

static std::wstring getExePath()
{
    wchar_t buf[MAX_PATH] = {};
    GetModuleFileNameW(nullptr, buf, MAX_PATH);
    return std::wstring(buf);
}

// ────────────────────────────────────────────────────────────────
// Reads northdl_path.txt next to the exe, if present.
// ────────────────────────────────────────────────────────────────
static std::wstring getNorthDLPath()
{
    std::wstring dir = getExeDir();
    g_logPath = dir + L"\\northdl_host.log";

    std::wifstream cfg(
        std::filesystem::path(dir) / L"northdl_path.txt"
    );
    if (cfg.is_open())
    {
        std::wstring line;
        while (std::getline(cfg, line))
        {
            if (!line.empty() && line.back() == L'\r')
                line.pop_back();

            if (!line.empty() && line[0] != L'#')
            {
                log("[path] " + WideToUtf8(line));
                return line;
            }
        }
        log("[path] northdl_path.txt found but no valid path");
    }
    else
    {
        log("[path] northdl_path.txt not found, using fallback");
    }

    return dir + L"\\NorthDL.exe";
}

static std::string readMessage()
{
    uint32_t len = 0;
    if (!std::cin.read(reinterpret_cast<char*>(&len), 4))
        return {};
    if (len == 0 || len > 1048576)
        return {};
    std::string msg(len, '\0');
    if (!std::cin.read(&msg[0], len))
        return {};
    return msg;
}

static void sendMessage(const std::string& json)
{
    uint32_t len = static_cast<uint32_t>(json.size());
    std::cout.write(reinterpret_cast<const char*>(&len), 4);
    std::cout.write(json.data(), len);
    std::cout.flush();
}

static std::string extractUrl(const std::string& json)
{
    auto keyPos = json.find("\"url\"");
    if (keyPos == std::string::npos) return {};

    auto colon = json.find(':', keyPos + 5);
    if (colon == std::string::npos) return {};

    auto q1 = json.find('"', colon + 1);
    if (q1 == std::string::npos) return {};

    std::string result;
    size_t i = q1 + 1;
    while (i < json.size() && json[i] != '"')
    {
        if (json[i] == '\\' && i + 1 < json.size())
        {
            ++i;
            switch (json[i])
            {
                case '"':  result += '"';  break;
                case '\\': result += '\\'; break;
                case '/':  result += '/';  break;
                case 'n':  result += '\n'; break;
                case 't':  result += '\t'; break;
                case 'r':  result += '\r'; break;
                default:   result += json[i]; break;
            }
        }
        else
        {
            result += json[i];
        }
        ++i;
    }
    return result;
}

static bool launchNorthDL(const std::wstring& exePath, const std::wstring& url)
{
    std::wstring cmdLine = L"\"" + exePath + L"\" --dw \"" + url + L"\"";

    std::vector<wchar_t> cmd(cmdLine.begin(), cmdLine.end());
    cmd.push_back(L'\0');

    STARTUPINFOW       si = {};
    PROCESS_INFORMATION pi = {};
    si.cb = sizeof(si);

    std::wstring workDir = exePath.substr(0, exePath.rfind(L'\\'));

    BOOL ok = CreateProcessW(
        nullptr, cmd.data(),
        nullptr, nullptr,
        FALSE,
        CREATE_BREAKAWAY_FROM_JOB | DETACHED_PROCESS,
        nullptr, workDir.c_str(),
        &si, &pi
    );

    if (ok)
    {
        log("[ok] CreateProcess succeeded, PID: " + std::to_string(pi.dwProcessId));
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
    }

    return ok;
}

// ════════════════════════════════════════════════════════════════
//  Install logic ( --install )
// ════════════════════════════════════════════════════════════════

static bool writePathTxt(const std::wstring& dir, const std::wstring& northdlPath)
{
    std::wofstream f(std::filesystem::path(dir) / L"northdl_path.txt", std::ios::trunc);
    if (!f.is_open()) return false;
    f << L"# Path to NorthDL.exe\n";
    f << northdlPath << L"\n";
    return true;
}

static std::string escapeJsonPath(const std::string& path)
{
    std::string out;
    out.reserve(path.size() * 2);
    for (char c : path)
    {
        if (c == '\\') out += "\\\\";
        else if (c == '"') out += "\\\"";
        else out += c;
    }
    return out;
}

static bool writeHostJson(const std::wstring& dir, const std::wstring& exePath)
{
    std::ofstream f(std::filesystem::path(dir) / L"northdl_host.json", std::ios::trunc);
    if (!f.is_open()) return false;

    std::string exePathUtf8 = WideToUtf8(exePath);
    std::string escaped = escapeJsonPath(exePathUtf8);

    f << "{\n";
    f << "  \"name\": \"com.northdl.host\",\n";
    f << "  \"description\": \"NorthDL Native Messaging Host\",\n";
    f << "  \"path\": \"" << escaped << "\",\n";
    f << "  \"type\": \"stdio\",\n";
    f << "  \"allowed_extensions\": [\"northdl@northdl.app\"]\n";
    f << "}\n";
    return true;
}

static bool registerInRegistry(const std::wstring& jsonPath)
{
    HKEY hKey;
    LONG res = RegCreateKeyExW(
        HKEY_CURRENT_USER,
        L"Software\\Mozilla\\NativeMessagingHosts\\com.northdl.host",
        0, nullptr, REG_OPTION_NON_VOLATILE, KEY_SET_VALUE, nullptr,
        &hKey, nullptr);

    if (res != ERROR_SUCCESS)
        return false;

    res = RegSetValueExW(
        hKey, nullptr, 0, REG_SZ,
        reinterpret_cast<const BYTE*>(jsonPath.c_str()),
        static_cast<DWORD>((jsonPath.size() + 1) * sizeof(wchar_t)));

    RegCloseKey(hKey);
    return res == ERROR_SUCCESS;
}

// Fully silent install — no console, no interaction.
// Usage: northdl_host.exe --install "C:\path\to\NorthDL.exe"
// Exit code: 0 = success, non-zero = failure (see northdl_host.log for details)
static int runInstall(const std::wstring& northdlPath)
{
    std::wstring dir     = getExeDir();
    std::wstring exePath = getExePath();
    g_logPath = dir + L"\\northdl_host.log";

    log("[install] starting silent install, northdlPath=" + WideToUtf8(northdlPath));

    if (northdlPath.empty())
    {
        log("[install][error] no path argument provided");
        return 1;
    }

    if (!writePathTxt(dir, northdlPath))
    {
        log("[install][error] could not write northdl_path.txt");
        return 1;
    }

    if (!writeHostJson(dir, exePath))
    {
        log("[install][error] could not write northdl_host.json");
        return 1;
    }

    std::wstring jsonPath = dir + L"\\northdl_host.json";
    if (!registerInRegistry(jsonPath))
    {
        log("[install][error] registry write failed");
        return 1;
    }

    log("[install][ok] installation complete");
    return 0;
}

// ════════════════════════════════════════════════════════════════
//  Normal Native Messaging Host mode
// ════════════════════════════════════════════════════════════════
static int runHost()
{
    _setmode(_fileno(stdin),  _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);

    std::string msg = readMessage();
    log("[msg] " + (msg.empty() ? "EMPTY" : msg));

    if (msg.empty())
    {
        sendMessage(R"({"status":"error","message":"empty message"})");
        return 1;
    }

    std::string url = extractUrl(msg);
    log("[url] " + (url.empty() ? "NOT FOUND" : url));

    if (url.empty())
    {
        sendMessage(R"({"status":"error","message":"url not found"})");
        return 1;
    }

    std::wstring wurl = Utf8ToWide(url);
    std::wstring northdlPath = getNorthDLPath();

    DWORD attr = GetFileAttributesW(northdlPath.c_str());
    if (attr == INVALID_FILE_ATTRIBUTES)
    {
        log("[error] NorthDL.exe not found at: " + WideToUtf8(northdlPath));
        sendMessage(R"({"status":"error","message":"NorthDL.exe not found"})");
        return 1;
    }

    if (!launchNorthDL(northdlPath, wurl))
    {
        DWORD err = GetLastError();
        log("[error] CreateProcess failed, code: " + std::to_string(err));
        sendMessage("{\"status\":\"error\",\"message\":\"CreateProcess failed:" + std::to_string(err) + "\"}");
        return 1;
    }

    log("[ok] Launched successfully");
    sendMessage(R"({"status":"launched"})");
    return 0;
}

int wmain(int argc, wchar_t* argv[])
{
    if (argc >= 2 && std::wstring(argv[1]) == L"--install")
    {
        std::wstring northdlPath = (argc >= 3) ? std::wstring(argv[2]) : std::wstring();
        return runInstall(northdlPath);
    }

    return runHost();
}