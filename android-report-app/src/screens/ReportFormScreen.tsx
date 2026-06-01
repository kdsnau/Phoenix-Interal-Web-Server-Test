import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AutocompleteField from '../components/AutocompleteField';
import TimePickerField from '../components/TimePickerField';
import PhotoPicker from '../components/PhotoPicker';
import { loadDraft, saveDraft, clearDraft, emptyDraft, ReportDraft } from '../storage/draft';
import { postReport } from '../services/slack';
import { saveReport, markReportSent, getUnsentReports } from '../db/clients';
import { upsertJob } from '../db/clients';
import { recordSubmission } from '../services/notifications';
import { theme } from '../constants/theme';
import type { RootStackParamList } from '../../App';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ReportForm'>;
  route: { params: { userName: string } };
};

type Draft = Omit<ReportDraft, 'savedAt'>;

export default function ReportFormScreen({ navigation, route }: Props) {
  const { userName } = route.params;

  const [form, setForm]           = useState<Draft>(emptyDraft(userName) as Draft);
  const [submitting, setSubmitting] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const saveTimer                  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftTimer                 = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load existing draft on mount
  useEffect(() => {
    loadDraft().then(d => {
      if (d) setForm({ ...d });
    });
  }, []);

  // Auto-save draft on any field change (debounced 600ms)
  const autosave = useCallback((updated: Draft) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await saveDraft(updated);
      setDraftSaved(true);
      if (draftTimer.current) clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => setDraftSaved(false), 2000);
    }, 600);
  }, []);

  const update = (patch: Partial<Draft>) => {
    setForm(prev => {
      const next = { ...prev, ...patch };
      autosave(next);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!form.jobName.trim()) {
      Alert.alert('Missing Field', 'Job name is required.');
      return;
    }

    setSubmitting(true);

    // Save locally first so nothing is lost
    const localId = await saveReport({
      jobName:     form.jobName,
      rfq:         form.rfq,
      technicians: form.technicians,
      arrival:     form.arrival && form.departure
        ? `${form.arrival} – ${form.departure}`
        : form.arrival || form.departure || '',
      work:        form.work,
      parts:       form.parts,
      returnTrip:  form.returnTrip,
      photoCount:  form.photoUris.length,
      slackSent:   false,
    });

    // Remember this job name for future autocomplete
    if (form.jobName.trim()) await upsertJob(form.jobName.trim());

    // Attempt Slack post
    let sent = false;
    try {
      await postReport({
        jobName:     form.jobName,
        rfq:         form.rfq,
        technicians: form.technicians,
        arrival:     form.arrival && form.departure
          ? `${form.arrival} – ${form.departure}`
          : form.arrival || form.departure || '',
        work:        form.work,
        parts:       form.parts,
        returnTrip:  form.returnTrip,
        photoCount:  form.photoUris.length,
      });
      sent = true;
      await markReportSent(localId);
    } catch {
      // Will retry on next app open
    }

    await recordSubmission();
    await clearDraft();
    setSubmitting(false);

    Alert.alert(
      sent ? 'Report Submitted' : 'Saved — Not Sent',
      sent
        ? 'Your report has been posted to Slack.'
        : 'No internet connection. Your report is saved and will be sent automatically when you reconnect.',
      [{ text: 'Done', onPress: () => navigation.goBack() }]
    );
  };

  // Retry any queued unsent reports
  useEffect(() => {
    getUnsentReports().then(async pending => {
      for (const r of pending) {
        try {
          await postReport({
            jobName:     r.job_name,
            rfq:         r.rfq,
            technicians: r.technicians,
            arrival:     r.arrival,
            work:        r.work,
            parts:       r.parts,
            returnTrip:  r.return_trip === 1,
            photoCount:  r.photo_count,
          });
          await markReportSent(r.id);
        } catch { break; }
      }
    });
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >

        {/* Navbar */}
        <View style={styles.nav}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.navTitle}>New Report</Text>
          {draftSaved
            ? <Text style={styles.draftLabel}>Draft saved</Text>
            : <View style={styles.draftPlaceholder} />
          }
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Job Name — most prominent field */}
          <AutocompleteField
            label="Job Name"
            value={form.jobName}
            onChange={v => update({ jobName: v })}
            placeholder="Search clients or type job name…"
          />

          <FormField label="RFQ / Work Order #">
            <TextInput
              style={styles.input}
              value={form.rfq}
              onChangeText={v => update({ rfq: v })}
              placeholder="e.g. RFQ-2024-042"
              placeholderTextColor={theme.placeholder}
            />
          </FormField>

          <FormField label="Technicians">
            <TextInput
              style={styles.input}
              value={form.technicians}
              onChangeText={v => update({ technicians: v })}
              placeholder="Who was on-site?"
              placeholderTextColor={theme.placeholder}
            />
          </FormField>

          <TimePickerField
            arrival={form.arrival}
            departure={form.departure}
            onArrival={v   => update({ arrival: v })}
            onDeparture={v => update({ departure: v })}
          />

          <FormField label="What Work Was Completed">
            <TextInput
              style={[styles.input, styles.multiline]}
              value={form.work}
              onChangeText={v => update({ work: v })}
              placeholder="Describe the work completed…"
              placeholderTextColor={theme.placeholder}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
            />
          </FormField>

          <FormField label="Parts & Supplies Used">
            <TextInput
              style={[styles.input, styles.multiline, styles.multilineSm]}
              value={form.parts}
              onChangeText={v => update({ parts: v })}
              placeholder="List any parts or materials used…"
              placeholderTextColor={theme.placeholder}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </FormField>

          <FormField label="Return Trip Required?">
            <View style={styles.toggleRow}>
              <TouchableOpacity
                style={[styles.toggleBtn, !form.returnTrip && styles.toggleActive]}
                onPress={() => update({ returnTrip: false })}
              >
                <Text style={[styles.toggleText, !form.returnTrip && styles.toggleTextActive]}>
                  No — Complete
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toggleBtn, form.returnTrip && styles.toggleActiveWarn]}
                onPress={() => update({ returnTrip: true })}
              >
                <Text style={[styles.toggleText, form.returnTrip && styles.toggleTextActive]}>
                  Yes — Return Required
                </Text>
              </TouchableOpacity>
            </View>
          </FormField>

          <PhotoPicker
            uris={form.photoUris}
            onChange={uris => update({ photoUris: uris })}
          />

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.85}
          >
            {submitting
              ? <ActivityIndicator color={theme.white} />
              : <Text style={styles.submitText}>Submit Report</Text>
            }
          </TouchableOpacity>

          <View style={styles.bottomPad} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={fieldStyles.wrap}>
      <Text style={fieldStyles.label}>{label}</Text>
      {children}
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  wrap:  { marginBottom: theme.spacing.md },
  label: {
    color:         theme.subtext,
    fontSize:      theme.font.sm,
    fontWeight:    '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom:  theme.spacing.xs,
  },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg0 },
  kav:  { flex: 1 },
  nav: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    backgroundColor:   theme.bg1,
  },
  backBtn:  { minWidth: 70 },
  backText: { color: theme.accent, fontSize: theme.font.md },
  navTitle: {
    color:      theme.text,
    fontSize:   theme.font.lg,
    fontWeight: '700',
  },
  draftLabel: {
    color:    theme.success,
    fontSize: theme.font.sm - 1,
    minWidth: 70,
    textAlign: 'right',
  },
  draftPlaceholder: { minWidth: 70 },
  scroll:        { flex: 1 },
  scrollContent: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop:        theme.spacing.lg,
    paddingBottom:     theme.spacing.xl,
  },
  input: {
    backgroundColor:   theme.bg3,
    borderWidth:       1,
    borderColor:       theme.border,
    borderRadius:      theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical:   theme.spacing.sm + 2,
    color:             theme.text,
    fontSize:          theme.font.md,
  },
  multiline: {
    minHeight:   110,
    paddingTop:  theme.spacing.sm + 2,
  },
  multilineSm: {
    minHeight: 75,
  },
  toggleRow: {
    flexDirection: 'row',
    gap:           theme.spacing.sm,
  },
  toggleBtn: {
    flex:            1,
    borderWidth:     1,
    borderColor:     theme.border,
    borderRadius:    theme.radius.md,
    padding:         theme.spacing.md,
    alignItems:      'center',
    backgroundColor: theme.bg3,
  },
  toggleActive: {
    backgroundColor: 'rgba(39,174,96,0.15)',
    borderColor:     theme.success,
  },
  toggleActiveWarn: {
    backgroundColor: 'rgba(212,85,43,0.15)',
    borderColor:     theme.accent,
  },
  toggleText: {
    color:      theme.subtext,
    fontSize:   theme.font.sm,
    fontWeight: '600',
    textAlign:  'center',
  },
  toggleTextActive: {
    color: theme.text,
  },
  submitBtn: {
    backgroundColor: theme.accent,
    borderRadius:    theme.radius.xl,
    paddingVertical: theme.spacing.lg,
    alignItems:      'center',
    marginTop:       theme.spacing.lg,
    elevation:       4,
    shadowColor:     theme.accent,
    shadowOpacity:   0.4,
    shadowRadius:    10,
    shadowOffset:    { width: 0, height: 4 },
  },
  submitBtnDisabled: {
    backgroundColor: theme.accentDim,
    elevation: 0,
  },
  submitText: {
    color:      theme.white,
    fontSize:   theme.font.lg,
    fontWeight: '800',
  },
  bottomPad: { height: theme.spacing.xxl },
});
