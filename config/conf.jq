# Builds a RAGE:MP conf.json from environment variables.
#
# Usage:
#   jq -n --slurpfile defaults config/conf.defaults.json -f config/conf.jq
#
# Every setting is optional. When the matching environment variable is empty or
# unset, the value from conf.defaults.json is used (or the key is omitted, for
# settings RAGE:MP treats as "off when absent").
#
# Reference: https://wiki.rage.mp/wiki/Server_settings

# Raw env value, with empty string normalised to null.
def raw($key):
    $ENV[$key] | if . == null or . == "" then null else . end;

def s($key; $fallback):
    raw($key) // $fallback;

def n($key; $fallback):
    raw($key) | if . == null then $fallback else tonumber end;

def b($key; $fallback):
    raw($key)
    | if . == null then $fallback
      elif (ascii_downcase == "true") or . == "1" then true
      elif (ascii_downcase == "false") or . == "0" then false
      else $fallback
      end;

# Adds an optional key only when the environment variable is non-empty.
def opt($key; $setting):
    raw($key) as $value
    | if $value == null then . else .[$setting] = $value end;

# Adds an optional boolean key only when the environment variable is non-empty.
def optb($key; $setting):
    raw($key) as $value
    | if $value == null then .
      elif ($value | ascii_downcase == "true") or $value == "1" then .[$setting] = true
      elif ($value | ascii_downcase == "false") or $value == "0" then .[$setting] = false
      else . end;

# Adds an optional numeric key only when the environment variable is non-empty.
def optn($key; $setting):
    raw($key) as $value
    | if $value == null then . else .[$setting] = ($value | tonumber) end;

$defaults[0]
| .announce = b("RAGE_ANNOUNCE"; .announce)
| .bind = s("RAGE_BIND"; .bind)
| .csharp = s("RAGE_CSHARP"; .csharp)
| .["enable-http-security"] = b("RAGE_ENABLE_HTTP_SECURITY"; .["enable-http-security"])
| .["enable-nodejs"] = b("RAGE_ENABLE_NODEJS"; .["enable-nodejs"])
| .gamemode = s("RAGE_GAMEMODE"; .gamemode)
| .language = s("RAGE_LANGUAGE"; .language)
| .maxplayers = n("RAGE_MAXPLAYERS"; .maxplayers)
| .name = s("RAGE_NAME"; .name)
| .port = n("RAGE_PORT"; .port)
| .["stream-distance"] = n("RAGE_STREAM_DISTANCE"; .["stream-distance"])
| .["sync-rate"] = n("RAGE_SYNC_RATE"; .["sync-rate"])
| .url = s("RAGE_URL"; .url)
| .["voice-chat"] = b("RAGE_VOICE_CHAT"; false)
| .["disallow-multiple-connections-per-ip"] = b("RAGE_DISALLOW_MULTIPLE_CONNECTIONS_PER_IP"; false)
| .["limit-time-of-connections-per-ip"] = n("RAGE_LIMIT_TIME_OF_CONNECTIONS_PER_IP"; 0)
| .["server-side-weapons-only-mode"] = b("RAGE_SERVER_SIDE_WEAPONS_ONLY_MODE"; true)
| opt("RAGE_FQDN"; "fqdn")
| opt("RAGE_FASTDL_HOST"; "fastdl-host")
| opt("RAGE_CLIENT_PACKAGES_SHARED_FOLDER"; "client-packages-shared-folder")
| opt("RAGE_NODE_COMMANDLINE_FLAGS"; "node-commandline-flags")
| optn("RAGE_VOICE_CHAT_SAMPLE_RATE"; "voice-chat-sample-rate")
| optn("RAGE_MAX_PING"; "max-ping")
| optn("RAGE_MIN_FPS"; "min-fps")
| optn("RAGE_MAX_PACKET_LOSS"; "max-packet-loss")
| optn("RAGE_HTTP_THREADS"; "http-threads")
| optn("RAGE_RESOURCES_COMPRESSION_LEVEL"; "resources-compression-level")
| optn("RAGE_RESOURCE_SCAN_THREAD_LIMIT"; "resource-scan-thread-limit")
| optn("RAGE_SYNCHRONIZATION_EXTRAPOLATION_MULTIPLIER"; "synchronization-extrapolation-multiplier")
| optb("RAGE_ALLOW_CEF_DEBUGGING"; "allow-cef-debugging")
| optb("RAGE_API_THREADING_DEBUGGING"; "api-threading-debugging")
| optb("RAGE_CREATE_FASTDL_SNAPSHOT"; "create-fastdl-snapshot")
| optb("RAGE_DISABLE_CLIENT_PACKAGES_RAM_CACHE"; "disable-client-packages-ram-cache")
| if .url == "" then del(.url) else . end
