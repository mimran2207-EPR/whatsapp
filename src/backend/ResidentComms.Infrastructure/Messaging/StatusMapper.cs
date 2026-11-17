using System.Collections.Concurrent;
using System.Text.RegularExpressions;

namespace ResidentComms.Infrastructure.Messaging;

/// <summary>
/// The single place that maps Domain status enums to the UPPER_SNAKE strings stored in the Message table
/// (ProcessingState.RejectedBeforeSend &lt;-&gt; 'REJECTED_BEFORE_SEND'). Covered by a round-trip test against the DB CHECK values.
/// </summary>
public static partial class StatusMapper
{
    private static readonly ConcurrentDictionary<Type, (Dictionary<string, object> FromDb, Dictionary<object, string> ToDb)> Cache = new();

    public static string ToDb<T>(T value) where T : struct, Enum => Maps<T>().ToDb[value];

    public static T FromDb<T>(string db) where T : struct, Enum =>
        Maps<T>().FromDb.TryGetValue(db, out var v) ? (T)v : throw new ArgumentOutOfRangeException(nameof(db), db, $"Not a {typeof(T).Name} value.");

    private static (Dictionary<string, object> FromDb, Dictionary<object, string> ToDb) Maps<T>() where T : struct, Enum =>
        Cache.GetOrAdd(typeof(T), _ =>
        {
            var from = new Dictionary<string, object>();
            var to = new Dictionary<object, string>();
            foreach (var v in Enum.GetValues<T>())
            {
                var s = Boundary().Replace(v.ToString(), "_").ToUpperInvariant();
                from[s] = v;
                to[v] = s;
            }
            return (from, to);
        });

    [GeneratedRegex("(?<=[a-z])(?=[A-Z])")]
    private static partial Regex Boundary();
}
