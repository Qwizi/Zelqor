"""Dynamic admin forms for system module configuration."""

import json

from django import forms


class SystemModuleForm(forms.ModelForm):
    """
    Custom form that generates typed fields from config_schema.

    For system modules: cfg__ fields read/write the `config` JSON field.
    For game modules: cfg__ fields read/write the `default_config` JSON field.

    Field types supported:
    - int -> NumberInput with min/max
    - float -> NumberInput with step=0.01
    - bool -> CheckboxInput
    - str -> TextInput (or Select if 'options' defined)
    - list -> Textarea (JSON array)
    """

    class Meta:
        from apps.game_config.models import SystemModule

        model = SystemModule
        fields = "__all__"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance and self.instance.pk:
            self._generate_config_fields()

    def _get_config_source(self):
        """Return the config dict to read values from based on module type."""
        if self.instance.module_type == "game":
            return self.instance.default_config or {}
        return self.instance.config or {}

    def _generate_config_fields(self):
        """Generate form fields from config_schema."""
        schema = self.instance.config_schema or []
        config = self._get_config_source()

        for field_def in schema:
            key = field_def.get("key", "")
            if not key:
                continue

            field_name = f"cfg__{key}"
            label = field_def.get("label", key)
            field_type = field_def.get("type", "str")
            default = field_def.get("default")
            value = config.get(key, default)

            if field_type == "int":
                field = forms.IntegerField(
                    label=label,
                    required=False,
                    initial=value,
                    min_value=field_def.get("min"),
                    max_value=field_def.get("max"),
                    widget=forms.NumberInput(
                        attrs={
                            "class": "border-border bg-background text-foreground",
                            "style": "max-width: 200px;",
                        }
                    ),
                )
            elif field_type == "float":
                field = forms.FloatField(
                    label=label,
                    required=False,
                    initial=value,
                    min_value=field_def.get("min"),
                    max_value=field_def.get("max"),
                    widget=forms.NumberInput(
                        attrs={
                            "step": "0.01",
                            "class": "border-border bg-background text-foreground",
                            "style": "max-width: 200px;",
                        }
                    ),
                )
            elif field_type == "bool":
                field = forms.BooleanField(
                    label=label,
                    required=False,
                    initial=value,
                )
            elif field_type == "str" and "options" in field_def:
                choices = [(o, o) for o in field_def["options"]]
                field = forms.ChoiceField(
                    label=label,
                    required=False,
                    initial=value,
                    choices=choices,
                )
            elif field_type == "list":
                field = forms.CharField(
                    label=label,
                    required=False,
                    initial=json.dumps(value) if isinstance(value, list) else str(value),
                    widget=forms.Textarea(
                        attrs={
                            "rows": 3,
                            "class": "border-border bg-background text-foreground font-mono text-sm",
                            "placeholder": '["item1", "item2"]',
                        }
                    ),
                    help_text="JSON array",
                )
            else:
                field = forms.CharField(
                    label=label,
                    required=False,
                    initial=value or "",
                )

            self.fields[field_name] = field

    def clean(self):
        cleaned = super().clean()

        # Collect cfg__ fields back into the appropriate config dict
        schema = self.instance.config_schema if self.instance else []
        if not schema:
            return cleaned

        config = dict(self._get_config_source())
        for field_def in schema:
            key = field_def.get("key", "")
            field_name = f"cfg__{key}"
            if field_name not in cleaned:
                continue

            value = cleaned[field_name]
            field_type = field_def.get("type", "str")

            if field_type == "list" and isinstance(value, str):
                try:
                    value = json.loads(value)
                except (json.JSONDecodeError, TypeError):
                    value = field_def.get("default", [])

            if value is not None:
                config[key] = value

        # Write to the correct JSON field based on module type
        if self.instance.module_type == "game":
            cleaned["default_config"] = config
        else:
            cleaned["config"] = config
        return cleaned
