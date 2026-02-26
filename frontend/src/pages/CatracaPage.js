import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { api } from '../api';
import CredentialPanel from '../components/CredentialPanel';

export default function CatracaPage() {
  const [devices, setDevices] = useState([]);
  const [logs, setLogs] = useState([]);
  const [commands, setCommands] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [deviceName, setDeviceName] = useState('Gateway Toletus');
  const [loading, setLoading] = useState(true);
  const [tokenPanel, setTokenPanel] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [cmds, access, devs, opsAlerts] = await Promise.all([
        api.catracaCommands(),
        api.listTurnstileAccessLogs(50),
        api.listTurnstileDevices(),
        api.opsAlerts(),
      ]);
      setCommands(cmds);
      setLogs(access);
      setDevices(devs);
      setAlerts(opsAlerts.alerts || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(() => {
      Promise.all([api.listTurnstileAccessLogs(50), api.opsAlerts()])
        .then(([access, opsAlerts]) => {
          setLogs(access);
          setAlerts(opsAlerts.alerts || []);
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const createDevice = async () => {
    try {
      const created = await api.createTurnstileDevice({ name: deviceName });
      setDevices((prev) => [created, ...prev]);
      toast.success('Dispositivo criado');
      setTokenPanel({
        title: `Token do dispositivo ${created.device_id}`,
        description: 'Copie e guarde. O token so aparece no momento da criacao/rotacao.',
        fields: [
          { label: 'Device ID', value: created.device_id },
          { label: 'Device Token', value: created.token },
        ],
      });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const sendCommand = async (action) => {
    try {
      await api.catracaCommand({ action, message: '' });
      toast.success(`Comando ${action} enviado`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const rotateToken = async (deviceId) => {
    try {
      const rotated = await api.rotateTurnstileDeviceToken(deviceId);
      toast.success(`Token rotacionado para ${deviceId}`);
      setTokenPanel({
        title: `Novo token de ${deviceId}`,
        description: 'Atualize esse valor no gateway imediatamente.',
        fields: [
          { label: 'Device ID', value: deviceId },
          { label: 'Novo token', value: rotated.token },
        ],
      });
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-[#ccff00] border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl font-bold uppercase tracking-tight">Catraca</h1>
        <p className="text-zinc-400 mt-1">Gerencie dispositivos e acompanhe acessos (polling 5s).</p>
      </div>

      {tokenPanel && (
        <CredentialPanel
          title={tokenPanel.title}
          description={tokenPanel.description}
          fields={tokenPanel.fields}
          onClose={() => setTokenPanel(null)}
        />
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4 space-y-3">
        <h2 className="font-semibold uppercase text-sm tracking-wide">Dispositivos</h2>
        <div className="flex gap-2">
          <input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} className="flex-1 bg-zinc-950 border border-zinc-800 rounded-sm h-10 px-3" placeholder="Nome do dispositivo" />
          <button onClick={createDevice} className="bg-[#ccff00] text-black font-bold text-xs uppercase tracking-wider px-4 rounded-sm">Criar</button>
        </div>
        <ul className="space-y-2 text-sm">
          {devices.map((device) => (
            <li key={device.device_id} className="border border-zinc-800 rounded-sm px-3 py-2 flex items-center justify-between gap-3">
              <div>
                <div>{device.device_id} - {device.name}</div>
                <div className="text-xs text-zinc-500">
                  Ultimo seen: {device.last_seen_at ? new Date(device.last_seen_at).toLocaleString('pt-BR') : 'nunca'}
                  {device.blocked_until ? ` | Bloqueado ate ${new Date(device.blocked_until).toLocaleString('pt-BR')}` : ''}
                </div>
              </div>
              <button onClick={() => rotateToken(device.device_id)} className="bg-zinc-800 px-3 h-8 rounded-sm text-xs uppercase tracking-wide">
                Rotacionar token
              </button>
            </li>
          ))}
          {devices.length === 0 && <li className="text-zinc-500">Nenhum dispositivo criado nesta sessao.</li>}
        </ul>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
        <h2 className="font-semibold uppercase text-sm tracking-wide mb-2">Alertas operacionais</h2>
        <ul className="space-y-2 text-sm">
          {alerts.map((alert) => (
            <li key={alert.code} className="border border-amber-500/30 bg-amber-500/10 rounded-sm px-3 py-2">
              <span className="font-semibold mr-2">[{alert.severity}]</span>{alert.message}
            </li>
          ))}
          {alerts.length === 0 && <li className="text-zinc-500">Sem alertas no momento.</li>}
        </ul>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
        <h2 className="font-semibold uppercase text-sm tracking-wide mb-3">Comandos rapidos</h2>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => sendCommand('release_entry')} className="bg-zinc-800 px-4 h-10 rounded-sm">Liberar entrada</button>
          <button onClick={() => sendCommand('release_exit')} className="bg-zinc-800 px-4 h-10 rounded-sm">Liberar saida</button>
          <button onClick={() => sendCommand('block')} className="bg-zinc-800 px-4 h-10 rounded-sm">Bloquear</button>
        </div>
        <div className="mt-3 text-xs text-zinc-500">Comandos locais legados para o agente da catraca.</div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md overflow-x-auto">
        <div className="px-4 py-3 border-b border-zinc-800 font-semibold uppercase text-sm tracking-wide">Ultimos acessos</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-zinc-500 text-xs uppercase tracking-wider border-b border-zinc-800">
              <th className="text-left px-4 py-3">Data</th>
              <th className="text-left px-4 py-3">Metodo</th>
              <th className="text-left px-4 py-3">Credencial</th>
              <th className="text-left px-4 py-3">Decisao</th>
              <th className="text-left px-4 py-3">Motivo</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.access_id || log.created_at} className="border-b border-zinc-800/50">
                <td className="px-4 py-3 text-zinc-400">{log.created_at ? new Date(log.created_at).toLocaleString('pt-BR') : '-'}</td>
                <td className="px-4 py-3">{log.method || '-'}</td>
                <td className="px-4 py-3 font-mono text-xs">{log.credential || '-'}</td>
                <td className="px-4 py-3">{log.decision || '-'}</td>
                <td className="px-4 py-3 text-zinc-400">{log.reason || '-'}</td>
              </tr>
            ))}
            {logs.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-zinc-500">Sem acessos.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-md p-4">
        <h3 className="font-semibold uppercase text-sm tracking-wide mb-2">Historico de comandos</h3>
        <ul className="space-y-2 text-sm">
          {commands.map((command) => (
            <li key={command.cmd_id} className="border border-zinc-800 rounded-sm px-3 py-2">
              {command.action} - {command.status} - {command.created_at ? new Date(command.created_at).toLocaleString('pt-BR') : '-'}
            </li>
          ))}
          {commands.length === 0 && <li className="text-zinc-500">Sem comandos.</li>}
        </ul>
      </div>
    </div>
  );
}
